
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
 * Model Conversation
 * 
 */
export type Conversation = $Result.DefaultSelection<Prisma.$ConversationPayload>
/**
 * Model ChatSession
 * 
 */
export type ChatSession = $Result.DefaultSelection<Prisma.$ChatSessionPayload>
/**
 * Model UserMemory
 * 
 */
export type UserMemory = $Result.DefaultSelection<Prisma.$UserMemoryPayload>
/**
 * Model WorkoutPlan
 * 
 */
export type WorkoutPlan = $Result.DefaultSelection<Prisma.$WorkoutPlanPayload>
/**
 * Model PublishedPlan
 * 
 */
export type PublishedPlan = $Result.DefaultSelection<Prisma.$PublishedPlanPayload>
/**
 * Model PlanReview
 * 
 */
export type PlanReview = $Result.DefaultSelection<Prisma.$PlanReviewPayload>
/**
 * Model TrainingPackage
 * 
 */
export type TrainingPackage = $Result.DefaultSelection<Prisma.$TrainingPackagePayload>
/**
 * Model TrainingPackagePurchase
 * 
 */
export type TrainingPackagePurchase = $Result.DefaultSelection<Prisma.$TrainingPackagePurchasePayload>
/**
 * Model NutritionPlan
 * 
 */
export type NutritionPlan = $Result.DefaultSelection<Prisma.$NutritionPlanPayload>
/**
 * Model KnowledgeSource
 * 
 */
export type KnowledgeSource = $Result.DefaultSelection<Prisma.$KnowledgeSourcePayload>
/**
 * Model KnowledgeDocument
 * 
 */
export type KnowledgeDocument = $Result.DefaultSelection<Prisma.$KnowledgeDocumentPayload>
/**
 * Model KnowledgeChunk
 * 
 */
export type KnowledgeChunk = $Result.DefaultSelection<Prisma.$KnowledgeChunkPayload>
/**
 * Model KnowledgePipelineRun
 * 
 */
export type KnowledgePipelineRun = $Result.DefaultSelection<Prisma.$KnowledgePipelineRunPayload>
/**
 * Model KnowledgeReviewItem
 * 
 */
export type KnowledgeReviewItem = $Result.DefaultSelection<Prisma.$KnowledgeReviewItemPayload>

/**
 * Enums
 */
export namespace $Enums {
  export const PlanStatus: {
  QUEUED: 'QUEUED',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED'
};

export type PlanStatus = (typeof PlanStatus)[keyof typeof PlanStatus]


export const PtReviewStatus: {
  PENDING_PT_REVIEW: 'PENDING_PT_REVIEW',
  PT_APPROVED: 'PT_APPROVED',
  PT_REJECTED: 'PT_REJECTED'
};

export type PtReviewStatus = (typeof PtReviewStatus)[keyof typeof PtReviewStatus]


export const PublishModerationStatus: {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED'
};

export type PublishModerationStatus = (typeof PublishModerationStatus)[keyof typeof PublishModerationStatus]


export const TrainingPackageStatus: {
  ACTIVE: 'ACTIVE',
  ARCHIVED: 'ARCHIVED'
};

export type TrainingPackageStatus = (typeof TrainingPackageStatus)[keyof typeof TrainingPackageStatus]


export const TrainingPackagePurchaseStatus: {
  PENDING: 'PENDING',
  PAID: 'PAID',
  FAILED: 'FAILED'
};

export type TrainingPackagePurchaseStatus = (typeof TrainingPackagePurchaseStatus)[keyof typeof TrainingPackagePurchaseStatus]


export const KnowledgeSourceType: {
  RSS: 'RSS',
  API: 'API',
  WEB: 'WEB',
  LOCAL: 'LOCAL'
};

export type KnowledgeSourceType = (typeof KnowledgeSourceType)[keyof typeof KnowledgeSourceType]


export const KnowledgeDocumentTopic: {
  TRAINING: 'TRAINING',
  NUTRITION: 'NUTRITION',
  RECOVERY: 'RECOVERY',
  INJURY: 'INJURY',
  BODY_COMPOSITION: 'BODY_COMPOSITION',
  GENERAL: 'GENERAL'
};

export type KnowledgeDocumentTopic = (typeof KnowledgeDocumentTopic)[keyof typeof KnowledgeDocumentTopic]


export const KnowledgeDocumentStatus: {
  CRAWLED: 'CRAWLED',
  CLEANED: 'CLEANED',
  SCORED: 'SCORED',
  EMBEDDED: 'EMBEDDED',
  REJECTED: 'REJECTED',
  REVIEW: 'REVIEW'
};

export type KnowledgeDocumentStatus = (typeof KnowledgeDocumentStatus)[keyof typeof KnowledgeDocumentStatus]


export const KnowledgePipelineRunStatus: {
  RUNNING: 'RUNNING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED'
};

export type KnowledgePipelineRunStatus = (typeof KnowledgePipelineRunStatus)[keyof typeof KnowledgePipelineRunStatus]


export const KnowledgeReviewStatus: {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED'
};

export type KnowledgeReviewStatus = (typeof KnowledgeReviewStatus)[keyof typeof KnowledgeReviewStatus]

}

export type PlanStatus = $Enums.PlanStatus

export const PlanStatus: typeof $Enums.PlanStatus

export type PtReviewStatus = $Enums.PtReviewStatus

export const PtReviewStatus: typeof $Enums.PtReviewStatus

export type PublishModerationStatus = $Enums.PublishModerationStatus

export const PublishModerationStatus: typeof $Enums.PublishModerationStatus

export type TrainingPackageStatus = $Enums.TrainingPackageStatus

export const TrainingPackageStatus: typeof $Enums.TrainingPackageStatus

export type TrainingPackagePurchaseStatus = $Enums.TrainingPackagePurchaseStatus

export const TrainingPackagePurchaseStatus: typeof $Enums.TrainingPackagePurchaseStatus

export type KnowledgeSourceType = $Enums.KnowledgeSourceType

export const KnowledgeSourceType: typeof $Enums.KnowledgeSourceType

export type KnowledgeDocumentTopic = $Enums.KnowledgeDocumentTopic

export const KnowledgeDocumentTopic: typeof $Enums.KnowledgeDocumentTopic

export type KnowledgeDocumentStatus = $Enums.KnowledgeDocumentStatus

export const KnowledgeDocumentStatus: typeof $Enums.KnowledgeDocumentStatus

export type KnowledgePipelineRunStatus = $Enums.KnowledgePipelineRunStatus

export const KnowledgePipelineRunStatus: typeof $Enums.KnowledgePipelineRunStatus

export type KnowledgeReviewStatus = $Enums.KnowledgeReviewStatus

export const KnowledgeReviewStatus: typeof $Enums.KnowledgeReviewStatus

/**
 * ##  Prisma Client ʲˢ
 * 
 * Type-safe database client for TypeScript & Node.js
 * @example
 * ```
 * const prisma = new PrismaClient()
 * // Fetch zero or more Conversations
 * const conversations = await prisma.conversation.findMany()
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
   * // Fetch zero or more Conversations
   * const conversations = await prisma.conversation.findMany()
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
   * `prisma.conversation`: Exposes CRUD operations for the **Conversation** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Conversations
    * const conversations = await prisma.conversation.findMany()
    * ```
    */
  get conversation(): Prisma.ConversationDelegate<ExtArgs>;

  /**
   * `prisma.chatSession`: Exposes CRUD operations for the **ChatSession** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more ChatSessions
    * const chatSessions = await prisma.chatSession.findMany()
    * ```
    */
  get chatSession(): Prisma.ChatSessionDelegate<ExtArgs>;

  /**
   * `prisma.userMemory`: Exposes CRUD operations for the **UserMemory** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more UserMemories
    * const userMemories = await prisma.userMemory.findMany()
    * ```
    */
  get userMemory(): Prisma.UserMemoryDelegate<ExtArgs>;

  /**
   * `prisma.workoutPlan`: Exposes CRUD operations for the **WorkoutPlan** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more WorkoutPlans
    * const workoutPlans = await prisma.workoutPlan.findMany()
    * ```
    */
  get workoutPlan(): Prisma.WorkoutPlanDelegate<ExtArgs>;

  /**
   * `prisma.publishedPlan`: Exposes CRUD operations for the **PublishedPlan** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more PublishedPlans
    * const publishedPlans = await prisma.publishedPlan.findMany()
    * ```
    */
  get publishedPlan(): Prisma.PublishedPlanDelegate<ExtArgs>;

  /**
   * `prisma.planReview`: Exposes CRUD operations for the **PlanReview** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more PlanReviews
    * const planReviews = await prisma.planReview.findMany()
    * ```
    */
  get planReview(): Prisma.PlanReviewDelegate<ExtArgs>;

  /**
   * `prisma.trainingPackage`: Exposes CRUD operations for the **TrainingPackage** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more TrainingPackages
    * const trainingPackages = await prisma.trainingPackage.findMany()
    * ```
    */
  get trainingPackage(): Prisma.TrainingPackageDelegate<ExtArgs>;

  /**
   * `prisma.trainingPackagePurchase`: Exposes CRUD operations for the **TrainingPackagePurchase** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more TrainingPackagePurchases
    * const trainingPackagePurchases = await prisma.trainingPackagePurchase.findMany()
    * ```
    */
  get trainingPackagePurchase(): Prisma.TrainingPackagePurchaseDelegate<ExtArgs>;

  /**
   * `prisma.nutritionPlan`: Exposes CRUD operations for the **NutritionPlan** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more NutritionPlans
    * const nutritionPlans = await prisma.nutritionPlan.findMany()
    * ```
    */
  get nutritionPlan(): Prisma.NutritionPlanDelegate<ExtArgs>;

  /**
   * `prisma.knowledgeSource`: Exposes CRUD operations for the **KnowledgeSource** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more KnowledgeSources
    * const knowledgeSources = await prisma.knowledgeSource.findMany()
    * ```
    */
  get knowledgeSource(): Prisma.KnowledgeSourceDelegate<ExtArgs>;

  /**
   * `prisma.knowledgeDocument`: Exposes CRUD operations for the **KnowledgeDocument** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more KnowledgeDocuments
    * const knowledgeDocuments = await prisma.knowledgeDocument.findMany()
    * ```
    */
  get knowledgeDocument(): Prisma.KnowledgeDocumentDelegate<ExtArgs>;

  /**
   * `prisma.knowledgeChunk`: Exposes CRUD operations for the **KnowledgeChunk** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more KnowledgeChunks
    * const knowledgeChunks = await prisma.knowledgeChunk.findMany()
    * ```
    */
  get knowledgeChunk(): Prisma.KnowledgeChunkDelegate<ExtArgs>;

  /**
   * `prisma.knowledgePipelineRun`: Exposes CRUD operations for the **KnowledgePipelineRun** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more KnowledgePipelineRuns
    * const knowledgePipelineRuns = await prisma.knowledgePipelineRun.findMany()
    * ```
    */
  get knowledgePipelineRun(): Prisma.KnowledgePipelineRunDelegate<ExtArgs>;

  /**
   * `prisma.knowledgeReviewItem`: Exposes CRUD operations for the **KnowledgeReviewItem** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more KnowledgeReviewItems
    * const knowledgeReviewItems = await prisma.knowledgeReviewItem.findMany()
    * ```
    */
  get knowledgeReviewItem(): Prisma.KnowledgeReviewItemDelegate<ExtArgs>;
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
    Conversation: 'Conversation',
    ChatSession: 'ChatSession',
    UserMemory: 'UserMemory',
    WorkoutPlan: 'WorkoutPlan',
    PublishedPlan: 'PublishedPlan',
    PlanReview: 'PlanReview',
    TrainingPackage: 'TrainingPackage',
    TrainingPackagePurchase: 'TrainingPackagePurchase',
    NutritionPlan: 'NutritionPlan',
    KnowledgeSource: 'KnowledgeSource',
    KnowledgeDocument: 'KnowledgeDocument',
    KnowledgeChunk: 'KnowledgeChunk',
    KnowledgePipelineRun: 'KnowledgePipelineRun',
    KnowledgeReviewItem: 'KnowledgeReviewItem'
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
      modelProps: "conversation" | "chatSession" | "userMemory" | "workoutPlan" | "publishedPlan" | "planReview" | "trainingPackage" | "trainingPackagePurchase" | "nutritionPlan" | "knowledgeSource" | "knowledgeDocument" | "knowledgeChunk" | "knowledgePipelineRun" | "knowledgeReviewItem"
      txIsolationLevel: Prisma.TransactionIsolationLevel
    }
    model: {
      Conversation: {
        payload: Prisma.$ConversationPayload<ExtArgs>
        fields: Prisma.ConversationFieldRefs
        operations: {
          findUnique: {
            args: Prisma.ConversationFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ConversationPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.ConversationFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ConversationPayload>
          }
          findFirst: {
            args: Prisma.ConversationFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ConversationPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.ConversationFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ConversationPayload>
          }
          findMany: {
            args: Prisma.ConversationFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ConversationPayload>[]
          }
          create: {
            args: Prisma.ConversationCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ConversationPayload>
          }
          createMany: {
            args: Prisma.ConversationCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.ConversationCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ConversationPayload>[]
          }
          delete: {
            args: Prisma.ConversationDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ConversationPayload>
          }
          update: {
            args: Prisma.ConversationUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ConversationPayload>
          }
          deleteMany: {
            args: Prisma.ConversationDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.ConversationUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.ConversationUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ConversationPayload>
          }
          aggregate: {
            args: Prisma.ConversationAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateConversation>
          }
          groupBy: {
            args: Prisma.ConversationGroupByArgs<ExtArgs>
            result: $Utils.Optional<ConversationGroupByOutputType>[]
          }
          count: {
            args: Prisma.ConversationCountArgs<ExtArgs>
            result: $Utils.Optional<ConversationCountAggregateOutputType> | number
          }
        }
      }
      ChatSession: {
        payload: Prisma.$ChatSessionPayload<ExtArgs>
        fields: Prisma.ChatSessionFieldRefs
        operations: {
          findUnique: {
            args: Prisma.ChatSessionFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ChatSessionPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.ChatSessionFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ChatSessionPayload>
          }
          findFirst: {
            args: Prisma.ChatSessionFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ChatSessionPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.ChatSessionFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ChatSessionPayload>
          }
          findMany: {
            args: Prisma.ChatSessionFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ChatSessionPayload>[]
          }
          create: {
            args: Prisma.ChatSessionCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ChatSessionPayload>
          }
          createMany: {
            args: Prisma.ChatSessionCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.ChatSessionCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ChatSessionPayload>[]
          }
          delete: {
            args: Prisma.ChatSessionDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ChatSessionPayload>
          }
          update: {
            args: Prisma.ChatSessionUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ChatSessionPayload>
          }
          deleteMany: {
            args: Prisma.ChatSessionDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.ChatSessionUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.ChatSessionUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ChatSessionPayload>
          }
          aggregate: {
            args: Prisma.ChatSessionAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateChatSession>
          }
          groupBy: {
            args: Prisma.ChatSessionGroupByArgs<ExtArgs>
            result: $Utils.Optional<ChatSessionGroupByOutputType>[]
          }
          count: {
            args: Prisma.ChatSessionCountArgs<ExtArgs>
            result: $Utils.Optional<ChatSessionCountAggregateOutputType> | number
          }
        }
      }
      UserMemory: {
        payload: Prisma.$UserMemoryPayload<ExtArgs>
        fields: Prisma.UserMemoryFieldRefs
        operations: {
          findUnique: {
            args: Prisma.UserMemoryFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserMemoryPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.UserMemoryFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserMemoryPayload>
          }
          findFirst: {
            args: Prisma.UserMemoryFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserMemoryPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.UserMemoryFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserMemoryPayload>
          }
          findMany: {
            args: Prisma.UserMemoryFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserMemoryPayload>[]
          }
          create: {
            args: Prisma.UserMemoryCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserMemoryPayload>
          }
          createMany: {
            args: Prisma.UserMemoryCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.UserMemoryCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserMemoryPayload>[]
          }
          delete: {
            args: Prisma.UserMemoryDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserMemoryPayload>
          }
          update: {
            args: Prisma.UserMemoryUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserMemoryPayload>
          }
          deleteMany: {
            args: Prisma.UserMemoryDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.UserMemoryUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.UserMemoryUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserMemoryPayload>
          }
          aggregate: {
            args: Prisma.UserMemoryAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateUserMemory>
          }
          groupBy: {
            args: Prisma.UserMemoryGroupByArgs<ExtArgs>
            result: $Utils.Optional<UserMemoryGroupByOutputType>[]
          }
          count: {
            args: Prisma.UserMemoryCountArgs<ExtArgs>
            result: $Utils.Optional<UserMemoryCountAggregateOutputType> | number
          }
        }
      }
      WorkoutPlan: {
        payload: Prisma.$WorkoutPlanPayload<ExtArgs>
        fields: Prisma.WorkoutPlanFieldRefs
        operations: {
          findUnique: {
            args: Prisma.WorkoutPlanFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutPlanPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.WorkoutPlanFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutPlanPayload>
          }
          findFirst: {
            args: Prisma.WorkoutPlanFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutPlanPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.WorkoutPlanFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutPlanPayload>
          }
          findMany: {
            args: Prisma.WorkoutPlanFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutPlanPayload>[]
          }
          create: {
            args: Prisma.WorkoutPlanCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutPlanPayload>
          }
          createMany: {
            args: Prisma.WorkoutPlanCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.WorkoutPlanCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutPlanPayload>[]
          }
          delete: {
            args: Prisma.WorkoutPlanDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutPlanPayload>
          }
          update: {
            args: Prisma.WorkoutPlanUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutPlanPayload>
          }
          deleteMany: {
            args: Prisma.WorkoutPlanDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.WorkoutPlanUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.WorkoutPlanUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutPlanPayload>
          }
          aggregate: {
            args: Prisma.WorkoutPlanAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateWorkoutPlan>
          }
          groupBy: {
            args: Prisma.WorkoutPlanGroupByArgs<ExtArgs>
            result: $Utils.Optional<WorkoutPlanGroupByOutputType>[]
          }
          count: {
            args: Prisma.WorkoutPlanCountArgs<ExtArgs>
            result: $Utils.Optional<WorkoutPlanCountAggregateOutputType> | number
          }
        }
      }
      PublishedPlan: {
        payload: Prisma.$PublishedPlanPayload<ExtArgs>
        fields: Prisma.PublishedPlanFieldRefs
        operations: {
          findUnique: {
            args: Prisma.PublishedPlanFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PublishedPlanPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.PublishedPlanFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PublishedPlanPayload>
          }
          findFirst: {
            args: Prisma.PublishedPlanFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PublishedPlanPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.PublishedPlanFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PublishedPlanPayload>
          }
          findMany: {
            args: Prisma.PublishedPlanFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PublishedPlanPayload>[]
          }
          create: {
            args: Prisma.PublishedPlanCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PublishedPlanPayload>
          }
          createMany: {
            args: Prisma.PublishedPlanCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.PublishedPlanCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PublishedPlanPayload>[]
          }
          delete: {
            args: Prisma.PublishedPlanDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PublishedPlanPayload>
          }
          update: {
            args: Prisma.PublishedPlanUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PublishedPlanPayload>
          }
          deleteMany: {
            args: Prisma.PublishedPlanDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.PublishedPlanUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.PublishedPlanUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PublishedPlanPayload>
          }
          aggregate: {
            args: Prisma.PublishedPlanAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregatePublishedPlan>
          }
          groupBy: {
            args: Prisma.PublishedPlanGroupByArgs<ExtArgs>
            result: $Utils.Optional<PublishedPlanGroupByOutputType>[]
          }
          count: {
            args: Prisma.PublishedPlanCountArgs<ExtArgs>
            result: $Utils.Optional<PublishedPlanCountAggregateOutputType> | number
          }
        }
      }
      PlanReview: {
        payload: Prisma.$PlanReviewPayload<ExtArgs>
        fields: Prisma.PlanReviewFieldRefs
        operations: {
          findUnique: {
            args: Prisma.PlanReviewFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PlanReviewPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.PlanReviewFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PlanReviewPayload>
          }
          findFirst: {
            args: Prisma.PlanReviewFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PlanReviewPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.PlanReviewFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PlanReviewPayload>
          }
          findMany: {
            args: Prisma.PlanReviewFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PlanReviewPayload>[]
          }
          create: {
            args: Prisma.PlanReviewCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PlanReviewPayload>
          }
          createMany: {
            args: Prisma.PlanReviewCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.PlanReviewCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PlanReviewPayload>[]
          }
          delete: {
            args: Prisma.PlanReviewDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PlanReviewPayload>
          }
          update: {
            args: Prisma.PlanReviewUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PlanReviewPayload>
          }
          deleteMany: {
            args: Prisma.PlanReviewDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.PlanReviewUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.PlanReviewUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PlanReviewPayload>
          }
          aggregate: {
            args: Prisma.PlanReviewAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregatePlanReview>
          }
          groupBy: {
            args: Prisma.PlanReviewGroupByArgs<ExtArgs>
            result: $Utils.Optional<PlanReviewGroupByOutputType>[]
          }
          count: {
            args: Prisma.PlanReviewCountArgs<ExtArgs>
            result: $Utils.Optional<PlanReviewCountAggregateOutputType> | number
          }
        }
      }
      TrainingPackage: {
        payload: Prisma.$TrainingPackagePayload<ExtArgs>
        fields: Prisma.TrainingPackageFieldRefs
        operations: {
          findUnique: {
            args: Prisma.TrainingPackageFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TrainingPackagePayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.TrainingPackageFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TrainingPackagePayload>
          }
          findFirst: {
            args: Prisma.TrainingPackageFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TrainingPackagePayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.TrainingPackageFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TrainingPackagePayload>
          }
          findMany: {
            args: Prisma.TrainingPackageFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TrainingPackagePayload>[]
          }
          create: {
            args: Prisma.TrainingPackageCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TrainingPackagePayload>
          }
          createMany: {
            args: Prisma.TrainingPackageCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.TrainingPackageCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TrainingPackagePayload>[]
          }
          delete: {
            args: Prisma.TrainingPackageDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TrainingPackagePayload>
          }
          update: {
            args: Prisma.TrainingPackageUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TrainingPackagePayload>
          }
          deleteMany: {
            args: Prisma.TrainingPackageDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.TrainingPackageUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.TrainingPackageUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TrainingPackagePayload>
          }
          aggregate: {
            args: Prisma.TrainingPackageAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateTrainingPackage>
          }
          groupBy: {
            args: Prisma.TrainingPackageGroupByArgs<ExtArgs>
            result: $Utils.Optional<TrainingPackageGroupByOutputType>[]
          }
          count: {
            args: Prisma.TrainingPackageCountArgs<ExtArgs>
            result: $Utils.Optional<TrainingPackageCountAggregateOutputType> | number
          }
        }
      }
      TrainingPackagePurchase: {
        payload: Prisma.$TrainingPackagePurchasePayload<ExtArgs>
        fields: Prisma.TrainingPackagePurchaseFieldRefs
        operations: {
          findUnique: {
            args: Prisma.TrainingPackagePurchaseFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TrainingPackagePurchasePayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.TrainingPackagePurchaseFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TrainingPackagePurchasePayload>
          }
          findFirst: {
            args: Prisma.TrainingPackagePurchaseFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TrainingPackagePurchasePayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.TrainingPackagePurchaseFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TrainingPackagePurchasePayload>
          }
          findMany: {
            args: Prisma.TrainingPackagePurchaseFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TrainingPackagePurchasePayload>[]
          }
          create: {
            args: Prisma.TrainingPackagePurchaseCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TrainingPackagePurchasePayload>
          }
          createMany: {
            args: Prisma.TrainingPackagePurchaseCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.TrainingPackagePurchaseCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TrainingPackagePurchasePayload>[]
          }
          delete: {
            args: Prisma.TrainingPackagePurchaseDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TrainingPackagePurchasePayload>
          }
          update: {
            args: Prisma.TrainingPackagePurchaseUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TrainingPackagePurchasePayload>
          }
          deleteMany: {
            args: Prisma.TrainingPackagePurchaseDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.TrainingPackagePurchaseUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.TrainingPackagePurchaseUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TrainingPackagePurchasePayload>
          }
          aggregate: {
            args: Prisma.TrainingPackagePurchaseAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateTrainingPackagePurchase>
          }
          groupBy: {
            args: Prisma.TrainingPackagePurchaseGroupByArgs<ExtArgs>
            result: $Utils.Optional<TrainingPackagePurchaseGroupByOutputType>[]
          }
          count: {
            args: Prisma.TrainingPackagePurchaseCountArgs<ExtArgs>
            result: $Utils.Optional<TrainingPackagePurchaseCountAggregateOutputType> | number
          }
        }
      }
      NutritionPlan: {
        payload: Prisma.$NutritionPlanPayload<ExtArgs>
        fields: Prisma.NutritionPlanFieldRefs
        operations: {
          findUnique: {
            args: Prisma.NutritionPlanFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$NutritionPlanPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.NutritionPlanFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$NutritionPlanPayload>
          }
          findFirst: {
            args: Prisma.NutritionPlanFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$NutritionPlanPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.NutritionPlanFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$NutritionPlanPayload>
          }
          findMany: {
            args: Prisma.NutritionPlanFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$NutritionPlanPayload>[]
          }
          create: {
            args: Prisma.NutritionPlanCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$NutritionPlanPayload>
          }
          createMany: {
            args: Prisma.NutritionPlanCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.NutritionPlanCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$NutritionPlanPayload>[]
          }
          delete: {
            args: Prisma.NutritionPlanDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$NutritionPlanPayload>
          }
          update: {
            args: Prisma.NutritionPlanUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$NutritionPlanPayload>
          }
          deleteMany: {
            args: Prisma.NutritionPlanDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.NutritionPlanUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.NutritionPlanUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$NutritionPlanPayload>
          }
          aggregate: {
            args: Prisma.NutritionPlanAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateNutritionPlan>
          }
          groupBy: {
            args: Prisma.NutritionPlanGroupByArgs<ExtArgs>
            result: $Utils.Optional<NutritionPlanGroupByOutputType>[]
          }
          count: {
            args: Prisma.NutritionPlanCountArgs<ExtArgs>
            result: $Utils.Optional<NutritionPlanCountAggregateOutputType> | number
          }
        }
      }
      KnowledgeSource: {
        payload: Prisma.$KnowledgeSourcePayload<ExtArgs>
        fields: Prisma.KnowledgeSourceFieldRefs
        operations: {
          findUnique: {
            args: Prisma.KnowledgeSourceFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeSourcePayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.KnowledgeSourceFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeSourcePayload>
          }
          findFirst: {
            args: Prisma.KnowledgeSourceFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeSourcePayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.KnowledgeSourceFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeSourcePayload>
          }
          findMany: {
            args: Prisma.KnowledgeSourceFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeSourcePayload>[]
          }
          create: {
            args: Prisma.KnowledgeSourceCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeSourcePayload>
          }
          createMany: {
            args: Prisma.KnowledgeSourceCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.KnowledgeSourceCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeSourcePayload>[]
          }
          delete: {
            args: Prisma.KnowledgeSourceDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeSourcePayload>
          }
          update: {
            args: Prisma.KnowledgeSourceUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeSourcePayload>
          }
          deleteMany: {
            args: Prisma.KnowledgeSourceDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.KnowledgeSourceUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.KnowledgeSourceUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeSourcePayload>
          }
          aggregate: {
            args: Prisma.KnowledgeSourceAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateKnowledgeSource>
          }
          groupBy: {
            args: Prisma.KnowledgeSourceGroupByArgs<ExtArgs>
            result: $Utils.Optional<KnowledgeSourceGroupByOutputType>[]
          }
          count: {
            args: Prisma.KnowledgeSourceCountArgs<ExtArgs>
            result: $Utils.Optional<KnowledgeSourceCountAggregateOutputType> | number
          }
        }
      }
      KnowledgeDocument: {
        payload: Prisma.$KnowledgeDocumentPayload<ExtArgs>
        fields: Prisma.KnowledgeDocumentFieldRefs
        operations: {
          findUnique: {
            args: Prisma.KnowledgeDocumentFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeDocumentPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.KnowledgeDocumentFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeDocumentPayload>
          }
          findFirst: {
            args: Prisma.KnowledgeDocumentFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeDocumentPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.KnowledgeDocumentFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeDocumentPayload>
          }
          findMany: {
            args: Prisma.KnowledgeDocumentFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeDocumentPayload>[]
          }
          create: {
            args: Prisma.KnowledgeDocumentCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeDocumentPayload>
          }
          createMany: {
            args: Prisma.KnowledgeDocumentCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.KnowledgeDocumentCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeDocumentPayload>[]
          }
          delete: {
            args: Prisma.KnowledgeDocumentDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeDocumentPayload>
          }
          update: {
            args: Prisma.KnowledgeDocumentUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeDocumentPayload>
          }
          deleteMany: {
            args: Prisma.KnowledgeDocumentDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.KnowledgeDocumentUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.KnowledgeDocumentUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeDocumentPayload>
          }
          aggregate: {
            args: Prisma.KnowledgeDocumentAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateKnowledgeDocument>
          }
          groupBy: {
            args: Prisma.KnowledgeDocumentGroupByArgs<ExtArgs>
            result: $Utils.Optional<KnowledgeDocumentGroupByOutputType>[]
          }
          count: {
            args: Prisma.KnowledgeDocumentCountArgs<ExtArgs>
            result: $Utils.Optional<KnowledgeDocumentCountAggregateOutputType> | number
          }
        }
      }
      KnowledgeChunk: {
        payload: Prisma.$KnowledgeChunkPayload<ExtArgs>
        fields: Prisma.KnowledgeChunkFieldRefs
        operations: {
          findUnique: {
            args: Prisma.KnowledgeChunkFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeChunkPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.KnowledgeChunkFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeChunkPayload>
          }
          findFirst: {
            args: Prisma.KnowledgeChunkFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeChunkPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.KnowledgeChunkFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeChunkPayload>
          }
          findMany: {
            args: Prisma.KnowledgeChunkFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeChunkPayload>[]
          }
          create: {
            args: Prisma.KnowledgeChunkCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeChunkPayload>
          }
          createMany: {
            args: Prisma.KnowledgeChunkCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.KnowledgeChunkCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeChunkPayload>[]
          }
          delete: {
            args: Prisma.KnowledgeChunkDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeChunkPayload>
          }
          update: {
            args: Prisma.KnowledgeChunkUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeChunkPayload>
          }
          deleteMany: {
            args: Prisma.KnowledgeChunkDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.KnowledgeChunkUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.KnowledgeChunkUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeChunkPayload>
          }
          aggregate: {
            args: Prisma.KnowledgeChunkAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateKnowledgeChunk>
          }
          groupBy: {
            args: Prisma.KnowledgeChunkGroupByArgs<ExtArgs>
            result: $Utils.Optional<KnowledgeChunkGroupByOutputType>[]
          }
          count: {
            args: Prisma.KnowledgeChunkCountArgs<ExtArgs>
            result: $Utils.Optional<KnowledgeChunkCountAggregateOutputType> | number
          }
        }
      }
      KnowledgePipelineRun: {
        payload: Prisma.$KnowledgePipelineRunPayload<ExtArgs>
        fields: Prisma.KnowledgePipelineRunFieldRefs
        operations: {
          findUnique: {
            args: Prisma.KnowledgePipelineRunFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgePipelineRunPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.KnowledgePipelineRunFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgePipelineRunPayload>
          }
          findFirst: {
            args: Prisma.KnowledgePipelineRunFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgePipelineRunPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.KnowledgePipelineRunFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgePipelineRunPayload>
          }
          findMany: {
            args: Prisma.KnowledgePipelineRunFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgePipelineRunPayload>[]
          }
          create: {
            args: Prisma.KnowledgePipelineRunCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgePipelineRunPayload>
          }
          createMany: {
            args: Prisma.KnowledgePipelineRunCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.KnowledgePipelineRunCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgePipelineRunPayload>[]
          }
          delete: {
            args: Prisma.KnowledgePipelineRunDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgePipelineRunPayload>
          }
          update: {
            args: Prisma.KnowledgePipelineRunUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgePipelineRunPayload>
          }
          deleteMany: {
            args: Prisma.KnowledgePipelineRunDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.KnowledgePipelineRunUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.KnowledgePipelineRunUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgePipelineRunPayload>
          }
          aggregate: {
            args: Prisma.KnowledgePipelineRunAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateKnowledgePipelineRun>
          }
          groupBy: {
            args: Prisma.KnowledgePipelineRunGroupByArgs<ExtArgs>
            result: $Utils.Optional<KnowledgePipelineRunGroupByOutputType>[]
          }
          count: {
            args: Prisma.KnowledgePipelineRunCountArgs<ExtArgs>
            result: $Utils.Optional<KnowledgePipelineRunCountAggregateOutputType> | number
          }
        }
      }
      KnowledgeReviewItem: {
        payload: Prisma.$KnowledgeReviewItemPayload<ExtArgs>
        fields: Prisma.KnowledgeReviewItemFieldRefs
        operations: {
          findUnique: {
            args: Prisma.KnowledgeReviewItemFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeReviewItemPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.KnowledgeReviewItemFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeReviewItemPayload>
          }
          findFirst: {
            args: Prisma.KnowledgeReviewItemFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeReviewItemPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.KnowledgeReviewItemFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeReviewItemPayload>
          }
          findMany: {
            args: Prisma.KnowledgeReviewItemFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeReviewItemPayload>[]
          }
          create: {
            args: Prisma.KnowledgeReviewItemCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeReviewItemPayload>
          }
          createMany: {
            args: Prisma.KnowledgeReviewItemCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.KnowledgeReviewItemCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeReviewItemPayload>[]
          }
          delete: {
            args: Prisma.KnowledgeReviewItemDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeReviewItemPayload>
          }
          update: {
            args: Prisma.KnowledgeReviewItemUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeReviewItemPayload>
          }
          deleteMany: {
            args: Prisma.KnowledgeReviewItemDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.KnowledgeReviewItemUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.KnowledgeReviewItemUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeReviewItemPayload>
          }
          aggregate: {
            args: Prisma.KnowledgeReviewItemAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateKnowledgeReviewItem>
          }
          groupBy: {
            args: Prisma.KnowledgeReviewItemGroupByArgs<ExtArgs>
            result: $Utils.Optional<KnowledgeReviewItemGroupByOutputType>[]
          }
          count: {
            args: Prisma.KnowledgeReviewItemCountArgs<ExtArgs>
            result: $Utils.Optional<KnowledgeReviewItemCountAggregateOutputType> | number
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
   * Count Type WorkoutPlanCountOutputType
   */

  export type WorkoutPlanCountOutputType = {
    publishedListings: number
  }

  export type WorkoutPlanCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    publishedListings?: boolean | WorkoutPlanCountOutputTypeCountPublishedListingsArgs
  }

  // Custom InputTypes
  /**
   * WorkoutPlanCountOutputType without action
   */
  export type WorkoutPlanCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutPlanCountOutputType
     */
    select?: WorkoutPlanCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * WorkoutPlanCountOutputType without action
   */
  export type WorkoutPlanCountOutputTypeCountPublishedListingsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: PublishedPlanWhereInput
  }


  /**
   * Count Type PublishedPlanCountOutputType
   */

  export type PublishedPlanCountOutputType = {
    reviews: number
    packages: number
  }

  export type PublishedPlanCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    reviews?: boolean | PublishedPlanCountOutputTypeCountReviewsArgs
    packages?: boolean | PublishedPlanCountOutputTypeCountPackagesArgs
  }

  // Custom InputTypes
  /**
   * PublishedPlanCountOutputType without action
   */
  export type PublishedPlanCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PublishedPlanCountOutputType
     */
    select?: PublishedPlanCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * PublishedPlanCountOutputType without action
   */
  export type PublishedPlanCountOutputTypeCountReviewsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: PlanReviewWhereInput
  }

  /**
   * PublishedPlanCountOutputType without action
   */
  export type PublishedPlanCountOutputTypeCountPackagesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: TrainingPackageWhereInput
  }


  /**
   * Count Type TrainingPackageCountOutputType
   */

  export type TrainingPackageCountOutputType = {
    purchases: number
  }

  export type TrainingPackageCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    purchases?: boolean | TrainingPackageCountOutputTypeCountPurchasesArgs
  }

  // Custom InputTypes
  /**
   * TrainingPackageCountOutputType without action
   */
  export type TrainingPackageCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TrainingPackageCountOutputType
     */
    select?: TrainingPackageCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * TrainingPackageCountOutputType without action
   */
  export type TrainingPackageCountOutputTypeCountPurchasesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: TrainingPackagePurchaseWhereInput
  }


  /**
   * Count Type KnowledgeSourceCountOutputType
   */

  export type KnowledgeSourceCountOutputType = {
    documents: number
  }

  export type KnowledgeSourceCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    documents?: boolean | KnowledgeSourceCountOutputTypeCountDocumentsArgs
  }

  // Custom InputTypes
  /**
   * KnowledgeSourceCountOutputType without action
   */
  export type KnowledgeSourceCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeSourceCountOutputType
     */
    select?: KnowledgeSourceCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * KnowledgeSourceCountOutputType without action
   */
  export type KnowledgeSourceCountOutputTypeCountDocumentsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: KnowledgeDocumentWhereInput
  }


  /**
   * Count Type KnowledgeDocumentCountOutputType
   */

  export type KnowledgeDocumentCountOutputType = {
    chunks: number
    reviewItems: number
  }

  export type KnowledgeDocumentCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    chunks?: boolean | KnowledgeDocumentCountOutputTypeCountChunksArgs
    reviewItems?: boolean | KnowledgeDocumentCountOutputTypeCountReviewItemsArgs
  }

  // Custom InputTypes
  /**
   * KnowledgeDocumentCountOutputType without action
   */
  export type KnowledgeDocumentCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeDocumentCountOutputType
     */
    select?: KnowledgeDocumentCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * KnowledgeDocumentCountOutputType without action
   */
  export type KnowledgeDocumentCountOutputTypeCountChunksArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: KnowledgeChunkWhereInput
  }

  /**
   * KnowledgeDocumentCountOutputType without action
   */
  export type KnowledgeDocumentCountOutputTypeCountReviewItemsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: KnowledgeReviewItemWhereInput
  }


  /**
   * Models
   */

  /**
   * Model Conversation
   */

  export type AggregateConversation = {
    _count: ConversationCountAggregateOutputType | null
    _avg: ConversationAvgAggregateOutputType | null
    _sum: ConversationSumAggregateOutputType | null
    _min: ConversationMinAggregateOutputType | null
    _max: ConversationMaxAggregateOutputType | null
  }

  export type ConversationAvgAggregateOutputType = {
    responseTime: number | null
    promptTokens: number | null
    completionTokens: number | null
    totalTokens: number | null
    cost: number | null
    feedback: number | null
    warningCount: number | null
  }

  export type ConversationSumAggregateOutputType = {
    responseTime: number | null
    promptTokens: number | null
    completionTokens: number | null
    totalTokens: number | null
    cost: number | null
    feedback: number | null
    warningCount: number | null
  }

  export type ConversationMinAggregateOutputType = {
    id: string | null
    userId: string | null
    sessionId: string | null
    question: string | null
    answer: string | null
    modelUsed: string | null
    responseTime: number | null
    relevance: string | null
    relevanceExplanation: string | null
    promptTokens: number | null
    completionTokens: number | null
    totalTokens: number | null
    cost: number | null
    feedback: number | null
    feedbackTimestamp: Date | null
    traceId: string | null
    usedFallback: boolean | null
    usedDeterministicFallback: boolean | null
    responseLanguage: string | null
    routeIntent: string | null
    warningCount: number | null
    createdAt: Date | null
  }

  export type ConversationMaxAggregateOutputType = {
    id: string | null
    userId: string | null
    sessionId: string | null
    question: string | null
    answer: string | null
    modelUsed: string | null
    responseTime: number | null
    relevance: string | null
    relevanceExplanation: string | null
    promptTokens: number | null
    completionTokens: number | null
    totalTokens: number | null
    cost: number | null
    feedback: number | null
    feedbackTimestamp: Date | null
    traceId: string | null
    usedFallback: boolean | null
    usedDeterministicFallback: boolean | null
    responseLanguage: string | null
    routeIntent: string | null
    warningCount: number | null
    createdAt: Date | null
  }

  export type ConversationCountAggregateOutputType = {
    id: number
    userId: number
    sessionId: number
    question: number
    answer: number
    modelUsed: number
    responseTime: number
    relevance: number
    relevanceExplanation: number
    promptTokens: number
    completionTokens: number
    totalTokens: number
    cost: number
    feedback: number
    feedbackTimestamp: number
    traceId: number
    usedFallback: number
    usedDeterministicFallback: number
    responseLanguage: number
    routeIntent: number
    warningCount: number
    createdAt: number
    _all: number
  }


  export type ConversationAvgAggregateInputType = {
    responseTime?: true
    promptTokens?: true
    completionTokens?: true
    totalTokens?: true
    cost?: true
    feedback?: true
    warningCount?: true
  }

  export type ConversationSumAggregateInputType = {
    responseTime?: true
    promptTokens?: true
    completionTokens?: true
    totalTokens?: true
    cost?: true
    feedback?: true
    warningCount?: true
  }

  export type ConversationMinAggregateInputType = {
    id?: true
    userId?: true
    sessionId?: true
    question?: true
    answer?: true
    modelUsed?: true
    responseTime?: true
    relevance?: true
    relevanceExplanation?: true
    promptTokens?: true
    completionTokens?: true
    totalTokens?: true
    cost?: true
    feedback?: true
    feedbackTimestamp?: true
    traceId?: true
    usedFallback?: true
    usedDeterministicFallback?: true
    responseLanguage?: true
    routeIntent?: true
    warningCount?: true
    createdAt?: true
  }

  export type ConversationMaxAggregateInputType = {
    id?: true
    userId?: true
    sessionId?: true
    question?: true
    answer?: true
    modelUsed?: true
    responseTime?: true
    relevance?: true
    relevanceExplanation?: true
    promptTokens?: true
    completionTokens?: true
    totalTokens?: true
    cost?: true
    feedback?: true
    feedbackTimestamp?: true
    traceId?: true
    usedFallback?: true
    usedDeterministicFallback?: true
    responseLanguage?: true
    routeIntent?: true
    warningCount?: true
    createdAt?: true
  }

  export type ConversationCountAggregateInputType = {
    id?: true
    userId?: true
    sessionId?: true
    question?: true
    answer?: true
    modelUsed?: true
    responseTime?: true
    relevance?: true
    relevanceExplanation?: true
    promptTokens?: true
    completionTokens?: true
    totalTokens?: true
    cost?: true
    feedback?: true
    feedbackTimestamp?: true
    traceId?: true
    usedFallback?: true
    usedDeterministicFallback?: true
    responseLanguage?: true
    routeIntent?: true
    warningCount?: true
    createdAt?: true
    _all?: true
  }

  export type ConversationAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Conversation to aggregate.
     */
    where?: ConversationWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Conversations to fetch.
     */
    orderBy?: ConversationOrderByWithRelationInput | ConversationOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: ConversationWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Conversations from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Conversations.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Conversations
    **/
    _count?: true | ConversationCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: ConversationAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: ConversationSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: ConversationMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: ConversationMaxAggregateInputType
  }

  export type GetConversationAggregateType<T extends ConversationAggregateArgs> = {
        [P in keyof T & keyof AggregateConversation]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateConversation[P]>
      : GetScalarType<T[P], AggregateConversation[P]>
  }




  export type ConversationGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: ConversationWhereInput
    orderBy?: ConversationOrderByWithAggregationInput | ConversationOrderByWithAggregationInput[]
    by: ConversationScalarFieldEnum[] | ConversationScalarFieldEnum
    having?: ConversationScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: ConversationCountAggregateInputType | true
    _avg?: ConversationAvgAggregateInputType
    _sum?: ConversationSumAggregateInputType
    _min?: ConversationMinAggregateInputType
    _max?: ConversationMaxAggregateInputType
  }

  export type ConversationGroupByOutputType = {
    id: string
    userId: string | null
    sessionId: string | null
    question: string
    answer: string
    modelUsed: string
    responseTime: number
    relevance: string | null
    relevanceExplanation: string | null
    promptTokens: number
    completionTokens: number
    totalTokens: number
    cost: number
    feedback: number | null
    feedbackTimestamp: Date | null
    traceId: string | null
    usedFallback: boolean
    usedDeterministicFallback: boolean
    responseLanguage: string | null
    routeIntent: string | null
    warningCount: number
    createdAt: Date
    _count: ConversationCountAggregateOutputType | null
    _avg: ConversationAvgAggregateOutputType | null
    _sum: ConversationSumAggregateOutputType | null
    _min: ConversationMinAggregateOutputType | null
    _max: ConversationMaxAggregateOutputType | null
  }

  type GetConversationGroupByPayload<T extends ConversationGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<ConversationGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof ConversationGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], ConversationGroupByOutputType[P]>
            : GetScalarType<T[P], ConversationGroupByOutputType[P]>
        }
      >
    >


  export type ConversationSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    userId?: boolean
    sessionId?: boolean
    question?: boolean
    answer?: boolean
    modelUsed?: boolean
    responseTime?: boolean
    relevance?: boolean
    relevanceExplanation?: boolean
    promptTokens?: boolean
    completionTokens?: boolean
    totalTokens?: boolean
    cost?: boolean
    feedback?: boolean
    feedbackTimestamp?: boolean
    traceId?: boolean
    usedFallback?: boolean
    usedDeterministicFallback?: boolean
    responseLanguage?: boolean
    routeIntent?: boolean
    warningCount?: boolean
    createdAt?: boolean
  }, ExtArgs["result"]["conversation"]>

  export type ConversationSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    userId?: boolean
    sessionId?: boolean
    question?: boolean
    answer?: boolean
    modelUsed?: boolean
    responseTime?: boolean
    relevance?: boolean
    relevanceExplanation?: boolean
    promptTokens?: boolean
    completionTokens?: boolean
    totalTokens?: boolean
    cost?: boolean
    feedback?: boolean
    feedbackTimestamp?: boolean
    traceId?: boolean
    usedFallback?: boolean
    usedDeterministicFallback?: boolean
    responseLanguage?: boolean
    routeIntent?: boolean
    warningCount?: boolean
    createdAt?: boolean
  }, ExtArgs["result"]["conversation"]>

  export type ConversationSelectScalar = {
    id?: boolean
    userId?: boolean
    sessionId?: boolean
    question?: boolean
    answer?: boolean
    modelUsed?: boolean
    responseTime?: boolean
    relevance?: boolean
    relevanceExplanation?: boolean
    promptTokens?: boolean
    completionTokens?: boolean
    totalTokens?: boolean
    cost?: boolean
    feedback?: boolean
    feedbackTimestamp?: boolean
    traceId?: boolean
    usedFallback?: boolean
    usedDeterministicFallback?: boolean
    responseLanguage?: boolean
    routeIntent?: boolean
    warningCount?: boolean
    createdAt?: boolean
  }


  export type $ConversationPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "Conversation"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: string
      userId: string | null
      sessionId: string | null
      question: string
      answer: string
      modelUsed: string
      responseTime: number
      relevance: string | null
      relevanceExplanation: string | null
      promptTokens: number
      completionTokens: number
      totalTokens: number
      cost: number
      feedback: number | null
      feedbackTimestamp: Date | null
      traceId: string | null
      usedFallback: boolean
      usedDeterministicFallback: boolean
      responseLanguage: string | null
      routeIntent: string | null
      warningCount: number
      createdAt: Date
    }, ExtArgs["result"]["conversation"]>
    composites: {}
  }

  type ConversationGetPayload<S extends boolean | null | undefined | ConversationDefaultArgs> = $Result.GetResult<Prisma.$ConversationPayload, S>

  type ConversationCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<ConversationFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: ConversationCountAggregateInputType | true
    }

  export interface ConversationDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['Conversation'], meta: { name: 'Conversation' } }
    /**
     * Find zero or one Conversation that matches the filter.
     * @param {ConversationFindUniqueArgs} args - Arguments to find a Conversation
     * @example
     * // Get one Conversation
     * const conversation = await prisma.conversation.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends ConversationFindUniqueArgs>(args: SelectSubset<T, ConversationFindUniqueArgs<ExtArgs>>): Prisma__ConversationClient<$Result.GetResult<Prisma.$ConversationPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one Conversation that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {ConversationFindUniqueOrThrowArgs} args - Arguments to find a Conversation
     * @example
     * // Get one Conversation
     * const conversation = await prisma.conversation.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends ConversationFindUniqueOrThrowArgs>(args: SelectSubset<T, ConversationFindUniqueOrThrowArgs<ExtArgs>>): Prisma__ConversationClient<$Result.GetResult<Prisma.$ConversationPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first Conversation that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ConversationFindFirstArgs} args - Arguments to find a Conversation
     * @example
     * // Get one Conversation
     * const conversation = await prisma.conversation.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends ConversationFindFirstArgs>(args?: SelectSubset<T, ConversationFindFirstArgs<ExtArgs>>): Prisma__ConversationClient<$Result.GetResult<Prisma.$ConversationPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first Conversation that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ConversationFindFirstOrThrowArgs} args - Arguments to find a Conversation
     * @example
     * // Get one Conversation
     * const conversation = await prisma.conversation.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends ConversationFindFirstOrThrowArgs>(args?: SelectSubset<T, ConversationFindFirstOrThrowArgs<ExtArgs>>): Prisma__ConversationClient<$Result.GetResult<Prisma.$ConversationPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more Conversations that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ConversationFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Conversations
     * const conversations = await prisma.conversation.findMany()
     * 
     * // Get first 10 Conversations
     * const conversations = await prisma.conversation.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const conversationWithIdOnly = await prisma.conversation.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends ConversationFindManyArgs>(args?: SelectSubset<T, ConversationFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ConversationPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a Conversation.
     * @param {ConversationCreateArgs} args - Arguments to create a Conversation.
     * @example
     * // Create one Conversation
     * const Conversation = await prisma.conversation.create({
     *   data: {
     *     // ... data to create a Conversation
     *   }
     * })
     * 
     */
    create<T extends ConversationCreateArgs>(args: SelectSubset<T, ConversationCreateArgs<ExtArgs>>): Prisma__ConversationClient<$Result.GetResult<Prisma.$ConversationPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many Conversations.
     * @param {ConversationCreateManyArgs} args - Arguments to create many Conversations.
     * @example
     * // Create many Conversations
     * const conversation = await prisma.conversation.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends ConversationCreateManyArgs>(args?: SelectSubset<T, ConversationCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Conversations and returns the data saved in the database.
     * @param {ConversationCreateManyAndReturnArgs} args - Arguments to create many Conversations.
     * @example
     * // Create many Conversations
     * const conversation = await prisma.conversation.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Conversations and only return the `id`
     * const conversationWithIdOnly = await prisma.conversation.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends ConversationCreateManyAndReturnArgs>(args?: SelectSubset<T, ConversationCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ConversationPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a Conversation.
     * @param {ConversationDeleteArgs} args - Arguments to delete one Conversation.
     * @example
     * // Delete one Conversation
     * const Conversation = await prisma.conversation.delete({
     *   where: {
     *     // ... filter to delete one Conversation
     *   }
     * })
     * 
     */
    delete<T extends ConversationDeleteArgs>(args: SelectSubset<T, ConversationDeleteArgs<ExtArgs>>): Prisma__ConversationClient<$Result.GetResult<Prisma.$ConversationPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one Conversation.
     * @param {ConversationUpdateArgs} args - Arguments to update one Conversation.
     * @example
     * // Update one Conversation
     * const conversation = await prisma.conversation.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends ConversationUpdateArgs>(args: SelectSubset<T, ConversationUpdateArgs<ExtArgs>>): Prisma__ConversationClient<$Result.GetResult<Prisma.$ConversationPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more Conversations.
     * @param {ConversationDeleteManyArgs} args - Arguments to filter Conversations to delete.
     * @example
     * // Delete a few Conversations
     * const { count } = await prisma.conversation.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends ConversationDeleteManyArgs>(args?: SelectSubset<T, ConversationDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Conversations.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ConversationUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Conversations
     * const conversation = await prisma.conversation.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends ConversationUpdateManyArgs>(args: SelectSubset<T, ConversationUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one Conversation.
     * @param {ConversationUpsertArgs} args - Arguments to update or create a Conversation.
     * @example
     * // Update or create a Conversation
     * const conversation = await prisma.conversation.upsert({
     *   create: {
     *     // ... data to create a Conversation
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Conversation we want to update
     *   }
     * })
     */
    upsert<T extends ConversationUpsertArgs>(args: SelectSubset<T, ConversationUpsertArgs<ExtArgs>>): Prisma__ConversationClient<$Result.GetResult<Prisma.$ConversationPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of Conversations.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ConversationCountArgs} args - Arguments to filter Conversations to count.
     * @example
     * // Count the number of Conversations
     * const count = await prisma.conversation.count({
     *   where: {
     *     // ... the filter for the Conversations we want to count
     *   }
     * })
    **/
    count<T extends ConversationCountArgs>(
      args?: Subset<T, ConversationCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], ConversationCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Conversation.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ConversationAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends ConversationAggregateArgs>(args: Subset<T, ConversationAggregateArgs>): Prisma.PrismaPromise<GetConversationAggregateType<T>>

    /**
     * Group by Conversation.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ConversationGroupByArgs} args - Group by arguments.
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
      T extends ConversationGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: ConversationGroupByArgs['orderBy'] }
        : { orderBy?: ConversationGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, ConversationGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetConversationGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the Conversation model
   */
  readonly fields: ConversationFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for Conversation.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__ConversationClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
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
   * Fields of the Conversation model
   */ 
  interface ConversationFieldRefs {
    readonly id: FieldRef<"Conversation", 'String'>
    readonly userId: FieldRef<"Conversation", 'String'>
    readonly sessionId: FieldRef<"Conversation", 'String'>
    readonly question: FieldRef<"Conversation", 'String'>
    readonly answer: FieldRef<"Conversation", 'String'>
    readonly modelUsed: FieldRef<"Conversation", 'String'>
    readonly responseTime: FieldRef<"Conversation", 'Float'>
    readonly relevance: FieldRef<"Conversation", 'String'>
    readonly relevanceExplanation: FieldRef<"Conversation", 'String'>
    readonly promptTokens: FieldRef<"Conversation", 'Int'>
    readonly completionTokens: FieldRef<"Conversation", 'Int'>
    readonly totalTokens: FieldRef<"Conversation", 'Int'>
    readonly cost: FieldRef<"Conversation", 'Float'>
    readonly feedback: FieldRef<"Conversation", 'Int'>
    readonly feedbackTimestamp: FieldRef<"Conversation", 'DateTime'>
    readonly traceId: FieldRef<"Conversation", 'String'>
    readonly usedFallback: FieldRef<"Conversation", 'Boolean'>
    readonly usedDeterministicFallback: FieldRef<"Conversation", 'Boolean'>
    readonly responseLanguage: FieldRef<"Conversation", 'String'>
    readonly routeIntent: FieldRef<"Conversation", 'String'>
    readonly warningCount: FieldRef<"Conversation", 'Int'>
    readonly createdAt: FieldRef<"Conversation", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * Conversation findUnique
   */
  export type ConversationFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Conversation
     */
    select?: ConversationSelect<ExtArgs> | null
    /**
     * Filter, which Conversation to fetch.
     */
    where: ConversationWhereUniqueInput
  }

  /**
   * Conversation findUniqueOrThrow
   */
  export type ConversationFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Conversation
     */
    select?: ConversationSelect<ExtArgs> | null
    /**
     * Filter, which Conversation to fetch.
     */
    where: ConversationWhereUniqueInput
  }

  /**
   * Conversation findFirst
   */
  export type ConversationFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Conversation
     */
    select?: ConversationSelect<ExtArgs> | null
    /**
     * Filter, which Conversation to fetch.
     */
    where?: ConversationWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Conversations to fetch.
     */
    orderBy?: ConversationOrderByWithRelationInput | ConversationOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Conversations.
     */
    cursor?: ConversationWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Conversations from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Conversations.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Conversations.
     */
    distinct?: ConversationScalarFieldEnum | ConversationScalarFieldEnum[]
  }

  /**
   * Conversation findFirstOrThrow
   */
  export type ConversationFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Conversation
     */
    select?: ConversationSelect<ExtArgs> | null
    /**
     * Filter, which Conversation to fetch.
     */
    where?: ConversationWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Conversations to fetch.
     */
    orderBy?: ConversationOrderByWithRelationInput | ConversationOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Conversations.
     */
    cursor?: ConversationWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Conversations from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Conversations.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Conversations.
     */
    distinct?: ConversationScalarFieldEnum | ConversationScalarFieldEnum[]
  }

  /**
   * Conversation findMany
   */
  export type ConversationFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Conversation
     */
    select?: ConversationSelect<ExtArgs> | null
    /**
     * Filter, which Conversations to fetch.
     */
    where?: ConversationWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Conversations to fetch.
     */
    orderBy?: ConversationOrderByWithRelationInput | ConversationOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Conversations.
     */
    cursor?: ConversationWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Conversations from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Conversations.
     */
    skip?: number
    distinct?: ConversationScalarFieldEnum | ConversationScalarFieldEnum[]
  }

  /**
   * Conversation create
   */
  export type ConversationCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Conversation
     */
    select?: ConversationSelect<ExtArgs> | null
    /**
     * The data needed to create a Conversation.
     */
    data: XOR<ConversationCreateInput, ConversationUncheckedCreateInput>
  }

  /**
   * Conversation createMany
   */
  export type ConversationCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Conversations.
     */
    data: ConversationCreateManyInput | ConversationCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Conversation createManyAndReturn
   */
  export type ConversationCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Conversation
     */
    select?: ConversationSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many Conversations.
     */
    data: ConversationCreateManyInput | ConversationCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Conversation update
   */
  export type ConversationUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Conversation
     */
    select?: ConversationSelect<ExtArgs> | null
    /**
     * The data needed to update a Conversation.
     */
    data: XOR<ConversationUpdateInput, ConversationUncheckedUpdateInput>
    /**
     * Choose, which Conversation to update.
     */
    where: ConversationWhereUniqueInput
  }

  /**
   * Conversation updateMany
   */
  export type ConversationUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Conversations.
     */
    data: XOR<ConversationUpdateManyMutationInput, ConversationUncheckedUpdateManyInput>
    /**
     * Filter which Conversations to update
     */
    where?: ConversationWhereInput
  }

  /**
   * Conversation upsert
   */
  export type ConversationUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Conversation
     */
    select?: ConversationSelect<ExtArgs> | null
    /**
     * The filter to search for the Conversation to update in case it exists.
     */
    where: ConversationWhereUniqueInput
    /**
     * In case the Conversation found by the `where` argument doesn't exist, create a new Conversation with this data.
     */
    create: XOR<ConversationCreateInput, ConversationUncheckedCreateInput>
    /**
     * In case the Conversation was found with the provided `where` argument, update it with this data.
     */
    update: XOR<ConversationUpdateInput, ConversationUncheckedUpdateInput>
  }

  /**
   * Conversation delete
   */
  export type ConversationDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Conversation
     */
    select?: ConversationSelect<ExtArgs> | null
    /**
     * Filter which Conversation to delete.
     */
    where: ConversationWhereUniqueInput
  }

  /**
   * Conversation deleteMany
   */
  export type ConversationDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Conversations to delete
     */
    where?: ConversationWhereInput
  }

  /**
   * Conversation without action
   */
  export type ConversationDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Conversation
     */
    select?: ConversationSelect<ExtArgs> | null
  }


  /**
   * Model ChatSession
   */

  export type AggregateChatSession = {
    _count: ChatSessionCountAggregateOutputType | null
    _min: ChatSessionMinAggregateOutputType | null
    _max: ChatSessionMaxAggregateOutputType | null
  }

  export type ChatSessionMinAggregateOutputType = {
    id: string | null
    userId: string | null
    title: string | null
    lastMessageAt: Date | null
    archivedAt: Date | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type ChatSessionMaxAggregateOutputType = {
    id: string | null
    userId: string | null
    title: string | null
    lastMessageAt: Date | null
    archivedAt: Date | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type ChatSessionCountAggregateOutputType = {
    id: number
    userId: number
    title: number
    lastMessageAt: number
    archivedAt: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type ChatSessionMinAggregateInputType = {
    id?: true
    userId?: true
    title?: true
    lastMessageAt?: true
    archivedAt?: true
    createdAt?: true
    updatedAt?: true
  }

  export type ChatSessionMaxAggregateInputType = {
    id?: true
    userId?: true
    title?: true
    lastMessageAt?: true
    archivedAt?: true
    createdAt?: true
    updatedAt?: true
  }

  export type ChatSessionCountAggregateInputType = {
    id?: true
    userId?: true
    title?: true
    lastMessageAt?: true
    archivedAt?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type ChatSessionAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which ChatSession to aggregate.
     */
    where?: ChatSessionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of ChatSessions to fetch.
     */
    orderBy?: ChatSessionOrderByWithRelationInput | ChatSessionOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: ChatSessionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` ChatSessions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` ChatSessions.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned ChatSessions
    **/
    _count?: true | ChatSessionCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: ChatSessionMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: ChatSessionMaxAggregateInputType
  }

  export type GetChatSessionAggregateType<T extends ChatSessionAggregateArgs> = {
        [P in keyof T & keyof AggregateChatSession]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateChatSession[P]>
      : GetScalarType<T[P], AggregateChatSession[P]>
  }




  export type ChatSessionGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: ChatSessionWhereInput
    orderBy?: ChatSessionOrderByWithAggregationInput | ChatSessionOrderByWithAggregationInput[]
    by: ChatSessionScalarFieldEnum[] | ChatSessionScalarFieldEnum
    having?: ChatSessionScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: ChatSessionCountAggregateInputType | true
    _min?: ChatSessionMinAggregateInputType
    _max?: ChatSessionMaxAggregateInputType
  }

  export type ChatSessionGroupByOutputType = {
    id: string
    userId: string
    title: string
    lastMessageAt: Date
    archivedAt: Date | null
    createdAt: Date
    updatedAt: Date
    _count: ChatSessionCountAggregateOutputType | null
    _min: ChatSessionMinAggregateOutputType | null
    _max: ChatSessionMaxAggregateOutputType | null
  }

  type GetChatSessionGroupByPayload<T extends ChatSessionGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<ChatSessionGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof ChatSessionGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], ChatSessionGroupByOutputType[P]>
            : GetScalarType<T[P], ChatSessionGroupByOutputType[P]>
        }
      >
    >


  export type ChatSessionSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    userId?: boolean
    title?: boolean
    lastMessageAt?: boolean
    archivedAt?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["chatSession"]>

  export type ChatSessionSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    userId?: boolean
    title?: boolean
    lastMessageAt?: boolean
    archivedAt?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["chatSession"]>

  export type ChatSessionSelectScalar = {
    id?: boolean
    userId?: boolean
    title?: boolean
    lastMessageAt?: boolean
    archivedAt?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }


  export type $ChatSessionPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "ChatSession"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: string
      userId: string
      title: string
      lastMessageAt: Date
      archivedAt: Date | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["chatSession"]>
    composites: {}
  }

  type ChatSessionGetPayload<S extends boolean | null | undefined | ChatSessionDefaultArgs> = $Result.GetResult<Prisma.$ChatSessionPayload, S>

  type ChatSessionCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<ChatSessionFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: ChatSessionCountAggregateInputType | true
    }

  export interface ChatSessionDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['ChatSession'], meta: { name: 'ChatSession' } }
    /**
     * Find zero or one ChatSession that matches the filter.
     * @param {ChatSessionFindUniqueArgs} args - Arguments to find a ChatSession
     * @example
     * // Get one ChatSession
     * const chatSession = await prisma.chatSession.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends ChatSessionFindUniqueArgs>(args: SelectSubset<T, ChatSessionFindUniqueArgs<ExtArgs>>): Prisma__ChatSessionClient<$Result.GetResult<Prisma.$ChatSessionPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one ChatSession that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {ChatSessionFindUniqueOrThrowArgs} args - Arguments to find a ChatSession
     * @example
     * // Get one ChatSession
     * const chatSession = await prisma.chatSession.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends ChatSessionFindUniqueOrThrowArgs>(args: SelectSubset<T, ChatSessionFindUniqueOrThrowArgs<ExtArgs>>): Prisma__ChatSessionClient<$Result.GetResult<Prisma.$ChatSessionPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first ChatSession that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ChatSessionFindFirstArgs} args - Arguments to find a ChatSession
     * @example
     * // Get one ChatSession
     * const chatSession = await prisma.chatSession.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends ChatSessionFindFirstArgs>(args?: SelectSubset<T, ChatSessionFindFirstArgs<ExtArgs>>): Prisma__ChatSessionClient<$Result.GetResult<Prisma.$ChatSessionPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first ChatSession that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ChatSessionFindFirstOrThrowArgs} args - Arguments to find a ChatSession
     * @example
     * // Get one ChatSession
     * const chatSession = await prisma.chatSession.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends ChatSessionFindFirstOrThrowArgs>(args?: SelectSubset<T, ChatSessionFindFirstOrThrowArgs<ExtArgs>>): Prisma__ChatSessionClient<$Result.GetResult<Prisma.$ChatSessionPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more ChatSessions that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ChatSessionFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all ChatSessions
     * const chatSessions = await prisma.chatSession.findMany()
     * 
     * // Get first 10 ChatSessions
     * const chatSessions = await prisma.chatSession.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const chatSessionWithIdOnly = await prisma.chatSession.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends ChatSessionFindManyArgs>(args?: SelectSubset<T, ChatSessionFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ChatSessionPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a ChatSession.
     * @param {ChatSessionCreateArgs} args - Arguments to create a ChatSession.
     * @example
     * // Create one ChatSession
     * const ChatSession = await prisma.chatSession.create({
     *   data: {
     *     // ... data to create a ChatSession
     *   }
     * })
     * 
     */
    create<T extends ChatSessionCreateArgs>(args: SelectSubset<T, ChatSessionCreateArgs<ExtArgs>>): Prisma__ChatSessionClient<$Result.GetResult<Prisma.$ChatSessionPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many ChatSessions.
     * @param {ChatSessionCreateManyArgs} args - Arguments to create many ChatSessions.
     * @example
     * // Create many ChatSessions
     * const chatSession = await prisma.chatSession.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends ChatSessionCreateManyArgs>(args?: SelectSubset<T, ChatSessionCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many ChatSessions and returns the data saved in the database.
     * @param {ChatSessionCreateManyAndReturnArgs} args - Arguments to create many ChatSessions.
     * @example
     * // Create many ChatSessions
     * const chatSession = await prisma.chatSession.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many ChatSessions and only return the `id`
     * const chatSessionWithIdOnly = await prisma.chatSession.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends ChatSessionCreateManyAndReturnArgs>(args?: SelectSubset<T, ChatSessionCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ChatSessionPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a ChatSession.
     * @param {ChatSessionDeleteArgs} args - Arguments to delete one ChatSession.
     * @example
     * // Delete one ChatSession
     * const ChatSession = await prisma.chatSession.delete({
     *   where: {
     *     // ... filter to delete one ChatSession
     *   }
     * })
     * 
     */
    delete<T extends ChatSessionDeleteArgs>(args: SelectSubset<T, ChatSessionDeleteArgs<ExtArgs>>): Prisma__ChatSessionClient<$Result.GetResult<Prisma.$ChatSessionPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one ChatSession.
     * @param {ChatSessionUpdateArgs} args - Arguments to update one ChatSession.
     * @example
     * // Update one ChatSession
     * const chatSession = await prisma.chatSession.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends ChatSessionUpdateArgs>(args: SelectSubset<T, ChatSessionUpdateArgs<ExtArgs>>): Prisma__ChatSessionClient<$Result.GetResult<Prisma.$ChatSessionPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more ChatSessions.
     * @param {ChatSessionDeleteManyArgs} args - Arguments to filter ChatSessions to delete.
     * @example
     * // Delete a few ChatSessions
     * const { count } = await prisma.chatSession.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends ChatSessionDeleteManyArgs>(args?: SelectSubset<T, ChatSessionDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more ChatSessions.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ChatSessionUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many ChatSessions
     * const chatSession = await prisma.chatSession.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends ChatSessionUpdateManyArgs>(args: SelectSubset<T, ChatSessionUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one ChatSession.
     * @param {ChatSessionUpsertArgs} args - Arguments to update or create a ChatSession.
     * @example
     * // Update or create a ChatSession
     * const chatSession = await prisma.chatSession.upsert({
     *   create: {
     *     // ... data to create a ChatSession
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the ChatSession we want to update
     *   }
     * })
     */
    upsert<T extends ChatSessionUpsertArgs>(args: SelectSubset<T, ChatSessionUpsertArgs<ExtArgs>>): Prisma__ChatSessionClient<$Result.GetResult<Prisma.$ChatSessionPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of ChatSessions.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ChatSessionCountArgs} args - Arguments to filter ChatSessions to count.
     * @example
     * // Count the number of ChatSessions
     * const count = await prisma.chatSession.count({
     *   where: {
     *     // ... the filter for the ChatSessions we want to count
     *   }
     * })
    **/
    count<T extends ChatSessionCountArgs>(
      args?: Subset<T, ChatSessionCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], ChatSessionCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a ChatSession.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ChatSessionAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends ChatSessionAggregateArgs>(args: Subset<T, ChatSessionAggregateArgs>): Prisma.PrismaPromise<GetChatSessionAggregateType<T>>

    /**
     * Group by ChatSession.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ChatSessionGroupByArgs} args - Group by arguments.
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
      T extends ChatSessionGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: ChatSessionGroupByArgs['orderBy'] }
        : { orderBy?: ChatSessionGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, ChatSessionGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetChatSessionGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the ChatSession model
   */
  readonly fields: ChatSessionFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for ChatSession.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__ChatSessionClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
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
   * Fields of the ChatSession model
   */ 
  interface ChatSessionFieldRefs {
    readonly id: FieldRef<"ChatSession", 'String'>
    readonly userId: FieldRef<"ChatSession", 'String'>
    readonly title: FieldRef<"ChatSession", 'String'>
    readonly lastMessageAt: FieldRef<"ChatSession", 'DateTime'>
    readonly archivedAt: FieldRef<"ChatSession", 'DateTime'>
    readonly createdAt: FieldRef<"ChatSession", 'DateTime'>
    readonly updatedAt: FieldRef<"ChatSession", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * ChatSession findUnique
   */
  export type ChatSessionFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ChatSession
     */
    select?: ChatSessionSelect<ExtArgs> | null
    /**
     * Filter, which ChatSession to fetch.
     */
    where: ChatSessionWhereUniqueInput
  }

  /**
   * ChatSession findUniqueOrThrow
   */
  export type ChatSessionFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ChatSession
     */
    select?: ChatSessionSelect<ExtArgs> | null
    /**
     * Filter, which ChatSession to fetch.
     */
    where: ChatSessionWhereUniqueInput
  }

  /**
   * ChatSession findFirst
   */
  export type ChatSessionFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ChatSession
     */
    select?: ChatSessionSelect<ExtArgs> | null
    /**
     * Filter, which ChatSession to fetch.
     */
    where?: ChatSessionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of ChatSessions to fetch.
     */
    orderBy?: ChatSessionOrderByWithRelationInput | ChatSessionOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for ChatSessions.
     */
    cursor?: ChatSessionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` ChatSessions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` ChatSessions.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of ChatSessions.
     */
    distinct?: ChatSessionScalarFieldEnum | ChatSessionScalarFieldEnum[]
  }

  /**
   * ChatSession findFirstOrThrow
   */
  export type ChatSessionFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ChatSession
     */
    select?: ChatSessionSelect<ExtArgs> | null
    /**
     * Filter, which ChatSession to fetch.
     */
    where?: ChatSessionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of ChatSessions to fetch.
     */
    orderBy?: ChatSessionOrderByWithRelationInput | ChatSessionOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for ChatSessions.
     */
    cursor?: ChatSessionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` ChatSessions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` ChatSessions.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of ChatSessions.
     */
    distinct?: ChatSessionScalarFieldEnum | ChatSessionScalarFieldEnum[]
  }

  /**
   * ChatSession findMany
   */
  export type ChatSessionFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ChatSession
     */
    select?: ChatSessionSelect<ExtArgs> | null
    /**
     * Filter, which ChatSessions to fetch.
     */
    where?: ChatSessionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of ChatSessions to fetch.
     */
    orderBy?: ChatSessionOrderByWithRelationInput | ChatSessionOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing ChatSessions.
     */
    cursor?: ChatSessionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` ChatSessions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` ChatSessions.
     */
    skip?: number
    distinct?: ChatSessionScalarFieldEnum | ChatSessionScalarFieldEnum[]
  }

  /**
   * ChatSession create
   */
  export type ChatSessionCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ChatSession
     */
    select?: ChatSessionSelect<ExtArgs> | null
    /**
     * The data needed to create a ChatSession.
     */
    data: XOR<ChatSessionCreateInput, ChatSessionUncheckedCreateInput>
  }

  /**
   * ChatSession createMany
   */
  export type ChatSessionCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many ChatSessions.
     */
    data: ChatSessionCreateManyInput | ChatSessionCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * ChatSession createManyAndReturn
   */
  export type ChatSessionCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ChatSession
     */
    select?: ChatSessionSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many ChatSessions.
     */
    data: ChatSessionCreateManyInput | ChatSessionCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * ChatSession update
   */
  export type ChatSessionUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ChatSession
     */
    select?: ChatSessionSelect<ExtArgs> | null
    /**
     * The data needed to update a ChatSession.
     */
    data: XOR<ChatSessionUpdateInput, ChatSessionUncheckedUpdateInput>
    /**
     * Choose, which ChatSession to update.
     */
    where: ChatSessionWhereUniqueInput
  }

  /**
   * ChatSession updateMany
   */
  export type ChatSessionUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update ChatSessions.
     */
    data: XOR<ChatSessionUpdateManyMutationInput, ChatSessionUncheckedUpdateManyInput>
    /**
     * Filter which ChatSessions to update
     */
    where?: ChatSessionWhereInput
  }

  /**
   * ChatSession upsert
   */
  export type ChatSessionUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ChatSession
     */
    select?: ChatSessionSelect<ExtArgs> | null
    /**
     * The filter to search for the ChatSession to update in case it exists.
     */
    where: ChatSessionWhereUniqueInput
    /**
     * In case the ChatSession found by the `where` argument doesn't exist, create a new ChatSession with this data.
     */
    create: XOR<ChatSessionCreateInput, ChatSessionUncheckedCreateInput>
    /**
     * In case the ChatSession was found with the provided `where` argument, update it with this data.
     */
    update: XOR<ChatSessionUpdateInput, ChatSessionUncheckedUpdateInput>
  }

  /**
   * ChatSession delete
   */
  export type ChatSessionDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ChatSession
     */
    select?: ChatSessionSelect<ExtArgs> | null
    /**
     * Filter which ChatSession to delete.
     */
    where: ChatSessionWhereUniqueInput
  }

  /**
   * ChatSession deleteMany
   */
  export type ChatSessionDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which ChatSessions to delete
     */
    where?: ChatSessionWhereInput
  }

  /**
   * ChatSession without action
   */
  export type ChatSessionDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ChatSession
     */
    select?: ChatSessionSelect<ExtArgs> | null
  }


  /**
   * Model UserMemory
   */

  export type AggregateUserMemory = {
    _count: UserMemoryCountAggregateOutputType | null
    _min: UserMemoryMinAggregateOutputType | null
    _max: UserMemoryMaxAggregateOutputType | null
  }

  export type UserMemoryMinAggregateOutputType = {
    id: string | null
    userId: string | null
    content: string | null
    category: string | null
    createdAt: Date | null
  }

  export type UserMemoryMaxAggregateOutputType = {
    id: string | null
    userId: string | null
    content: string | null
    category: string | null
    createdAt: Date | null
  }

  export type UserMemoryCountAggregateOutputType = {
    id: number
    userId: number
    content: number
    category: number
    createdAt: number
    _all: number
  }


  export type UserMemoryMinAggregateInputType = {
    id?: true
    userId?: true
    content?: true
    category?: true
    createdAt?: true
  }

  export type UserMemoryMaxAggregateInputType = {
    id?: true
    userId?: true
    content?: true
    category?: true
    createdAt?: true
  }

  export type UserMemoryCountAggregateInputType = {
    id?: true
    userId?: true
    content?: true
    category?: true
    createdAt?: true
    _all?: true
  }

  export type UserMemoryAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which UserMemory to aggregate.
     */
    where?: UserMemoryWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of UserMemories to fetch.
     */
    orderBy?: UserMemoryOrderByWithRelationInput | UserMemoryOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: UserMemoryWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` UserMemories from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` UserMemories.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned UserMemories
    **/
    _count?: true | UserMemoryCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: UserMemoryMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: UserMemoryMaxAggregateInputType
  }

  export type GetUserMemoryAggregateType<T extends UserMemoryAggregateArgs> = {
        [P in keyof T & keyof AggregateUserMemory]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateUserMemory[P]>
      : GetScalarType<T[P], AggregateUserMemory[P]>
  }




  export type UserMemoryGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: UserMemoryWhereInput
    orderBy?: UserMemoryOrderByWithAggregationInput | UserMemoryOrderByWithAggregationInput[]
    by: UserMemoryScalarFieldEnum[] | UserMemoryScalarFieldEnum
    having?: UserMemoryScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: UserMemoryCountAggregateInputType | true
    _min?: UserMemoryMinAggregateInputType
    _max?: UserMemoryMaxAggregateInputType
  }

  export type UserMemoryGroupByOutputType = {
    id: string
    userId: string
    content: string
    category: string | null
    createdAt: Date
    _count: UserMemoryCountAggregateOutputType | null
    _min: UserMemoryMinAggregateOutputType | null
    _max: UserMemoryMaxAggregateOutputType | null
  }

  type GetUserMemoryGroupByPayload<T extends UserMemoryGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<UserMemoryGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof UserMemoryGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], UserMemoryGroupByOutputType[P]>
            : GetScalarType<T[P], UserMemoryGroupByOutputType[P]>
        }
      >
    >


  export type UserMemorySelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    userId?: boolean
    content?: boolean
    category?: boolean
    createdAt?: boolean
  }, ExtArgs["result"]["userMemory"]>

  export type UserMemorySelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    userId?: boolean
    content?: boolean
    category?: boolean
    createdAt?: boolean
  }, ExtArgs["result"]["userMemory"]>

  export type UserMemorySelectScalar = {
    id?: boolean
    userId?: boolean
    content?: boolean
    category?: boolean
    createdAt?: boolean
  }


  export type $UserMemoryPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "UserMemory"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: string
      userId: string
      content: string
      category: string | null
      createdAt: Date
    }, ExtArgs["result"]["userMemory"]>
    composites: {}
  }

  type UserMemoryGetPayload<S extends boolean | null | undefined | UserMemoryDefaultArgs> = $Result.GetResult<Prisma.$UserMemoryPayload, S>

  type UserMemoryCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<UserMemoryFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: UserMemoryCountAggregateInputType | true
    }

  export interface UserMemoryDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['UserMemory'], meta: { name: 'UserMemory' } }
    /**
     * Find zero or one UserMemory that matches the filter.
     * @param {UserMemoryFindUniqueArgs} args - Arguments to find a UserMemory
     * @example
     * // Get one UserMemory
     * const userMemory = await prisma.userMemory.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends UserMemoryFindUniqueArgs>(args: SelectSubset<T, UserMemoryFindUniqueArgs<ExtArgs>>): Prisma__UserMemoryClient<$Result.GetResult<Prisma.$UserMemoryPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one UserMemory that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {UserMemoryFindUniqueOrThrowArgs} args - Arguments to find a UserMemory
     * @example
     * // Get one UserMemory
     * const userMemory = await prisma.userMemory.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends UserMemoryFindUniqueOrThrowArgs>(args: SelectSubset<T, UserMemoryFindUniqueOrThrowArgs<ExtArgs>>): Prisma__UserMemoryClient<$Result.GetResult<Prisma.$UserMemoryPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first UserMemory that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserMemoryFindFirstArgs} args - Arguments to find a UserMemory
     * @example
     * // Get one UserMemory
     * const userMemory = await prisma.userMemory.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends UserMemoryFindFirstArgs>(args?: SelectSubset<T, UserMemoryFindFirstArgs<ExtArgs>>): Prisma__UserMemoryClient<$Result.GetResult<Prisma.$UserMemoryPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first UserMemory that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserMemoryFindFirstOrThrowArgs} args - Arguments to find a UserMemory
     * @example
     * // Get one UserMemory
     * const userMemory = await prisma.userMemory.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends UserMemoryFindFirstOrThrowArgs>(args?: SelectSubset<T, UserMemoryFindFirstOrThrowArgs<ExtArgs>>): Prisma__UserMemoryClient<$Result.GetResult<Prisma.$UserMemoryPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more UserMemories that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserMemoryFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all UserMemories
     * const userMemories = await prisma.userMemory.findMany()
     * 
     * // Get first 10 UserMemories
     * const userMemories = await prisma.userMemory.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const userMemoryWithIdOnly = await prisma.userMemory.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends UserMemoryFindManyArgs>(args?: SelectSubset<T, UserMemoryFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$UserMemoryPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a UserMemory.
     * @param {UserMemoryCreateArgs} args - Arguments to create a UserMemory.
     * @example
     * // Create one UserMemory
     * const UserMemory = await prisma.userMemory.create({
     *   data: {
     *     // ... data to create a UserMemory
     *   }
     * })
     * 
     */
    create<T extends UserMemoryCreateArgs>(args: SelectSubset<T, UserMemoryCreateArgs<ExtArgs>>): Prisma__UserMemoryClient<$Result.GetResult<Prisma.$UserMemoryPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many UserMemories.
     * @param {UserMemoryCreateManyArgs} args - Arguments to create many UserMemories.
     * @example
     * // Create many UserMemories
     * const userMemory = await prisma.userMemory.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends UserMemoryCreateManyArgs>(args?: SelectSubset<T, UserMemoryCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many UserMemories and returns the data saved in the database.
     * @param {UserMemoryCreateManyAndReturnArgs} args - Arguments to create many UserMemories.
     * @example
     * // Create many UserMemories
     * const userMemory = await prisma.userMemory.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many UserMemories and only return the `id`
     * const userMemoryWithIdOnly = await prisma.userMemory.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends UserMemoryCreateManyAndReturnArgs>(args?: SelectSubset<T, UserMemoryCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$UserMemoryPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a UserMemory.
     * @param {UserMemoryDeleteArgs} args - Arguments to delete one UserMemory.
     * @example
     * // Delete one UserMemory
     * const UserMemory = await prisma.userMemory.delete({
     *   where: {
     *     // ... filter to delete one UserMemory
     *   }
     * })
     * 
     */
    delete<T extends UserMemoryDeleteArgs>(args: SelectSubset<T, UserMemoryDeleteArgs<ExtArgs>>): Prisma__UserMemoryClient<$Result.GetResult<Prisma.$UserMemoryPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one UserMemory.
     * @param {UserMemoryUpdateArgs} args - Arguments to update one UserMemory.
     * @example
     * // Update one UserMemory
     * const userMemory = await prisma.userMemory.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends UserMemoryUpdateArgs>(args: SelectSubset<T, UserMemoryUpdateArgs<ExtArgs>>): Prisma__UserMemoryClient<$Result.GetResult<Prisma.$UserMemoryPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more UserMemories.
     * @param {UserMemoryDeleteManyArgs} args - Arguments to filter UserMemories to delete.
     * @example
     * // Delete a few UserMemories
     * const { count } = await prisma.userMemory.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends UserMemoryDeleteManyArgs>(args?: SelectSubset<T, UserMemoryDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more UserMemories.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserMemoryUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many UserMemories
     * const userMemory = await prisma.userMemory.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends UserMemoryUpdateManyArgs>(args: SelectSubset<T, UserMemoryUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one UserMemory.
     * @param {UserMemoryUpsertArgs} args - Arguments to update or create a UserMemory.
     * @example
     * // Update or create a UserMemory
     * const userMemory = await prisma.userMemory.upsert({
     *   create: {
     *     // ... data to create a UserMemory
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the UserMemory we want to update
     *   }
     * })
     */
    upsert<T extends UserMemoryUpsertArgs>(args: SelectSubset<T, UserMemoryUpsertArgs<ExtArgs>>): Prisma__UserMemoryClient<$Result.GetResult<Prisma.$UserMemoryPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of UserMemories.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserMemoryCountArgs} args - Arguments to filter UserMemories to count.
     * @example
     * // Count the number of UserMemories
     * const count = await prisma.userMemory.count({
     *   where: {
     *     // ... the filter for the UserMemories we want to count
     *   }
     * })
    **/
    count<T extends UserMemoryCountArgs>(
      args?: Subset<T, UserMemoryCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], UserMemoryCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a UserMemory.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserMemoryAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends UserMemoryAggregateArgs>(args: Subset<T, UserMemoryAggregateArgs>): Prisma.PrismaPromise<GetUserMemoryAggregateType<T>>

    /**
     * Group by UserMemory.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserMemoryGroupByArgs} args - Group by arguments.
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
      T extends UserMemoryGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: UserMemoryGroupByArgs['orderBy'] }
        : { orderBy?: UserMemoryGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, UserMemoryGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetUserMemoryGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the UserMemory model
   */
  readonly fields: UserMemoryFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for UserMemory.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__UserMemoryClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
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
   * Fields of the UserMemory model
   */ 
  interface UserMemoryFieldRefs {
    readonly id: FieldRef<"UserMemory", 'String'>
    readonly userId: FieldRef<"UserMemory", 'String'>
    readonly content: FieldRef<"UserMemory", 'String'>
    readonly category: FieldRef<"UserMemory", 'String'>
    readonly createdAt: FieldRef<"UserMemory", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * UserMemory findUnique
   */
  export type UserMemoryFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserMemory
     */
    select?: UserMemorySelect<ExtArgs> | null
    /**
     * Filter, which UserMemory to fetch.
     */
    where: UserMemoryWhereUniqueInput
  }

  /**
   * UserMemory findUniqueOrThrow
   */
  export type UserMemoryFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserMemory
     */
    select?: UserMemorySelect<ExtArgs> | null
    /**
     * Filter, which UserMemory to fetch.
     */
    where: UserMemoryWhereUniqueInput
  }

  /**
   * UserMemory findFirst
   */
  export type UserMemoryFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserMemory
     */
    select?: UserMemorySelect<ExtArgs> | null
    /**
     * Filter, which UserMemory to fetch.
     */
    where?: UserMemoryWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of UserMemories to fetch.
     */
    orderBy?: UserMemoryOrderByWithRelationInput | UserMemoryOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for UserMemories.
     */
    cursor?: UserMemoryWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` UserMemories from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` UserMemories.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of UserMemories.
     */
    distinct?: UserMemoryScalarFieldEnum | UserMemoryScalarFieldEnum[]
  }

  /**
   * UserMemory findFirstOrThrow
   */
  export type UserMemoryFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserMemory
     */
    select?: UserMemorySelect<ExtArgs> | null
    /**
     * Filter, which UserMemory to fetch.
     */
    where?: UserMemoryWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of UserMemories to fetch.
     */
    orderBy?: UserMemoryOrderByWithRelationInput | UserMemoryOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for UserMemories.
     */
    cursor?: UserMemoryWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` UserMemories from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` UserMemories.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of UserMemories.
     */
    distinct?: UserMemoryScalarFieldEnum | UserMemoryScalarFieldEnum[]
  }

  /**
   * UserMemory findMany
   */
  export type UserMemoryFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserMemory
     */
    select?: UserMemorySelect<ExtArgs> | null
    /**
     * Filter, which UserMemories to fetch.
     */
    where?: UserMemoryWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of UserMemories to fetch.
     */
    orderBy?: UserMemoryOrderByWithRelationInput | UserMemoryOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing UserMemories.
     */
    cursor?: UserMemoryWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` UserMemories from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` UserMemories.
     */
    skip?: number
    distinct?: UserMemoryScalarFieldEnum | UserMemoryScalarFieldEnum[]
  }

  /**
   * UserMemory create
   */
  export type UserMemoryCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserMemory
     */
    select?: UserMemorySelect<ExtArgs> | null
    /**
     * The data needed to create a UserMemory.
     */
    data: XOR<UserMemoryCreateInput, UserMemoryUncheckedCreateInput>
  }

  /**
   * UserMemory createMany
   */
  export type UserMemoryCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many UserMemories.
     */
    data: UserMemoryCreateManyInput | UserMemoryCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * UserMemory createManyAndReturn
   */
  export type UserMemoryCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserMemory
     */
    select?: UserMemorySelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many UserMemories.
     */
    data: UserMemoryCreateManyInput | UserMemoryCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * UserMemory update
   */
  export type UserMemoryUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserMemory
     */
    select?: UserMemorySelect<ExtArgs> | null
    /**
     * The data needed to update a UserMemory.
     */
    data: XOR<UserMemoryUpdateInput, UserMemoryUncheckedUpdateInput>
    /**
     * Choose, which UserMemory to update.
     */
    where: UserMemoryWhereUniqueInput
  }

  /**
   * UserMemory updateMany
   */
  export type UserMemoryUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update UserMemories.
     */
    data: XOR<UserMemoryUpdateManyMutationInput, UserMemoryUncheckedUpdateManyInput>
    /**
     * Filter which UserMemories to update
     */
    where?: UserMemoryWhereInput
  }

  /**
   * UserMemory upsert
   */
  export type UserMemoryUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserMemory
     */
    select?: UserMemorySelect<ExtArgs> | null
    /**
     * The filter to search for the UserMemory to update in case it exists.
     */
    where: UserMemoryWhereUniqueInput
    /**
     * In case the UserMemory found by the `where` argument doesn't exist, create a new UserMemory with this data.
     */
    create: XOR<UserMemoryCreateInput, UserMemoryUncheckedCreateInput>
    /**
     * In case the UserMemory was found with the provided `where` argument, update it with this data.
     */
    update: XOR<UserMemoryUpdateInput, UserMemoryUncheckedUpdateInput>
  }

  /**
   * UserMemory delete
   */
  export type UserMemoryDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserMemory
     */
    select?: UserMemorySelect<ExtArgs> | null
    /**
     * Filter which UserMemory to delete.
     */
    where: UserMemoryWhereUniqueInput
  }

  /**
   * UserMemory deleteMany
   */
  export type UserMemoryDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which UserMemories to delete
     */
    where?: UserMemoryWhereInput
  }

  /**
   * UserMemory without action
   */
  export type UserMemoryDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserMemory
     */
    select?: UserMemorySelect<ExtArgs> | null
  }


  /**
   * Model WorkoutPlan
   */

  export type AggregateWorkoutPlan = {
    _count: WorkoutPlanCountAggregateOutputType | null
    _avg: WorkoutPlanAvgAggregateOutputType | null
    _sum: WorkoutPlanSumAggregateOutputType | null
    _min: WorkoutPlanMinAggregateOutputType | null
    _max: WorkoutPlanMaxAggregateOutputType | null
  }

  export type WorkoutPlanAvgAggregateOutputType = {
    duration: number | null
    daysPerWeek: number | null
    version: number | null
  }

  export type WorkoutPlanSumAggregateOutputType = {
    duration: number | null
    daysPerWeek: number | null
    version: number | null
  }

  export type WorkoutPlanMinAggregateOutputType = {
    id: string | null
    userId: string | null
    name: string | null
    description: string | null
    goal: string | null
    duration: number | null
    daysPerWeek: number | null
    status: $Enums.PlanStatus | null
    version: number | null
    jobId: string | null
    failReason: string | null
    ptUserId: string | null
    ptName: string | null
    clientName: string | null
    ptReviewStatus: $Enums.PtReviewStatus | null
    ptNote: string | null
    ptReviewedAt: Date | null
    archivedAt: Date | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type WorkoutPlanMaxAggregateOutputType = {
    id: string | null
    userId: string | null
    name: string | null
    description: string | null
    goal: string | null
    duration: number | null
    daysPerWeek: number | null
    status: $Enums.PlanStatus | null
    version: number | null
    jobId: string | null
    failReason: string | null
    ptUserId: string | null
    ptName: string | null
    clientName: string | null
    ptReviewStatus: $Enums.PtReviewStatus | null
    ptNote: string | null
    ptReviewedAt: Date | null
    archivedAt: Date | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type WorkoutPlanCountAggregateOutputType = {
    id: number
    userId: number
    name: number
    description: number
    goal: number
    duration: number
    daysPerWeek: number
    plan: number
    status: number
    version: number
    jobId: number
    failReason: number
    ptUserId: number
    ptName: number
    clientName: number
    ptReviewStatus: number
    ptNote: number
    ptReviewedAt: number
    archivedAt: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type WorkoutPlanAvgAggregateInputType = {
    duration?: true
    daysPerWeek?: true
    version?: true
  }

  export type WorkoutPlanSumAggregateInputType = {
    duration?: true
    daysPerWeek?: true
    version?: true
  }

  export type WorkoutPlanMinAggregateInputType = {
    id?: true
    userId?: true
    name?: true
    description?: true
    goal?: true
    duration?: true
    daysPerWeek?: true
    status?: true
    version?: true
    jobId?: true
    failReason?: true
    ptUserId?: true
    ptName?: true
    clientName?: true
    ptReviewStatus?: true
    ptNote?: true
    ptReviewedAt?: true
    archivedAt?: true
    createdAt?: true
    updatedAt?: true
  }

  export type WorkoutPlanMaxAggregateInputType = {
    id?: true
    userId?: true
    name?: true
    description?: true
    goal?: true
    duration?: true
    daysPerWeek?: true
    status?: true
    version?: true
    jobId?: true
    failReason?: true
    ptUserId?: true
    ptName?: true
    clientName?: true
    ptReviewStatus?: true
    ptNote?: true
    ptReviewedAt?: true
    archivedAt?: true
    createdAt?: true
    updatedAt?: true
  }

  export type WorkoutPlanCountAggregateInputType = {
    id?: true
    userId?: true
    name?: true
    description?: true
    goal?: true
    duration?: true
    daysPerWeek?: true
    plan?: true
    status?: true
    version?: true
    jobId?: true
    failReason?: true
    ptUserId?: true
    ptName?: true
    clientName?: true
    ptReviewStatus?: true
    ptNote?: true
    ptReviewedAt?: true
    archivedAt?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type WorkoutPlanAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which WorkoutPlan to aggregate.
     */
    where?: WorkoutPlanWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of WorkoutPlans to fetch.
     */
    orderBy?: WorkoutPlanOrderByWithRelationInput | WorkoutPlanOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: WorkoutPlanWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` WorkoutPlans from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` WorkoutPlans.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned WorkoutPlans
    **/
    _count?: true | WorkoutPlanCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: WorkoutPlanAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: WorkoutPlanSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: WorkoutPlanMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: WorkoutPlanMaxAggregateInputType
  }

  export type GetWorkoutPlanAggregateType<T extends WorkoutPlanAggregateArgs> = {
        [P in keyof T & keyof AggregateWorkoutPlan]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateWorkoutPlan[P]>
      : GetScalarType<T[P], AggregateWorkoutPlan[P]>
  }




  export type WorkoutPlanGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: WorkoutPlanWhereInput
    orderBy?: WorkoutPlanOrderByWithAggregationInput | WorkoutPlanOrderByWithAggregationInput[]
    by: WorkoutPlanScalarFieldEnum[] | WorkoutPlanScalarFieldEnum
    having?: WorkoutPlanScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: WorkoutPlanCountAggregateInputType | true
    _avg?: WorkoutPlanAvgAggregateInputType
    _sum?: WorkoutPlanSumAggregateInputType
    _min?: WorkoutPlanMinAggregateInputType
    _max?: WorkoutPlanMaxAggregateInputType
  }

  export type WorkoutPlanGroupByOutputType = {
    id: string
    userId: string
    name: string
    description: string | null
    goal: string
    duration: number
    daysPerWeek: number
    plan: JsonValue
    status: $Enums.PlanStatus
    version: number
    jobId: string | null
    failReason: string | null
    ptUserId: string | null
    ptName: string | null
    clientName: string | null
    ptReviewStatus: $Enums.PtReviewStatus | null
    ptNote: string | null
    ptReviewedAt: Date | null
    archivedAt: Date | null
    createdAt: Date
    updatedAt: Date
    _count: WorkoutPlanCountAggregateOutputType | null
    _avg: WorkoutPlanAvgAggregateOutputType | null
    _sum: WorkoutPlanSumAggregateOutputType | null
    _min: WorkoutPlanMinAggregateOutputType | null
    _max: WorkoutPlanMaxAggregateOutputType | null
  }

  type GetWorkoutPlanGroupByPayload<T extends WorkoutPlanGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<WorkoutPlanGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof WorkoutPlanGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], WorkoutPlanGroupByOutputType[P]>
            : GetScalarType<T[P], WorkoutPlanGroupByOutputType[P]>
        }
      >
    >


  export type WorkoutPlanSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    userId?: boolean
    name?: boolean
    description?: boolean
    goal?: boolean
    duration?: boolean
    daysPerWeek?: boolean
    plan?: boolean
    status?: boolean
    version?: boolean
    jobId?: boolean
    failReason?: boolean
    ptUserId?: boolean
    ptName?: boolean
    clientName?: boolean
    ptReviewStatus?: boolean
    ptNote?: boolean
    ptReviewedAt?: boolean
    archivedAt?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    publishedListings?: boolean | WorkoutPlan$publishedListingsArgs<ExtArgs>
    _count?: boolean | WorkoutPlanCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["workoutPlan"]>

  export type WorkoutPlanSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    userId?: boolean
    name?: boolean
    description?: boolean
    goal?: boolean
    duration?: boolean
    daysPerWeek?: boolean
    plan?: boolean
    status?: boolean
    version?: boolean
    jobId?: boolean
    failReason?: boolean
    ptUserId?: boolean
    ptName?: boolean
    clientName?: boolean
    ptReviewStatus?: boolean
    ptNote?: boolean
    ptReviewedAt?: boolean
    archivedAt?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["workoutPlan"]>

  export type WorkoutPlanSelectScalar = {
    id?: boolean
    userId?: boolean
    name?: boolean
    description?: boolean
    goal?: boolean
    duration?: boolean
    daysPerWeek?: boolean
    plan?: boolean
    status?: boolean
    version?: boolean
    jobId?: boolean
    failReason?: boolean
    ptUserId?: boolean
    ptName?: boolean
    clientName?: boolean
    ptReviewStatus?: boolean
    ptNote?: boolean
    ptReviewedAt?: boolean
    archivedAt?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type WorkoutPlanInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    publishedListings?: boolean | WorkoutPlan$publishedListingsArgs<ExtArgs>
    _count?: boolean | WorkoutPlanCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type WorkoutPlanIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {}

  export type $WorkoutPlanPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "WorkoutPlan"
    objects: {
      publishedListings: Prisma.$PublishedPlanPayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      userId: string
      name: string
      description: string | null
      goal: string
      duration: number
      daysPerWeek: number
      /**
       * Structured JSON matching PlanContentSchema once COMPLETED; empty object while QUEUED/PROCESSING
       */
      plan: Prisma.JsonValue
      status: $Enums.PlanStatus
      version: number
      /**
       * BullMQ job ID — used for polling via GET /plans/job/:jobId
       */
      jobId: string | null
      failReason: string | null
      ptUserId: string | null
      ptName: string | null
      clientName: string | null
      ptReviewStatus: $Enums.PtReviewStatus | null
      ptNote: string | null
      ptReviewedAt: Date | null
      archivedAt: Date | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["workoutPlan"]>
    composites: {}
  }

  type WorkoutPlanGetPayload<S extends boolean | null | undefined | WorkoutPlanDefaultArgs> = $Result.GetResult<Prisma.$WorkoutPlanPayload, S>

  type WorkoutPlanCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<WorkoutPlanFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: WorkoutPlanCountAggregateInputType | true
    }

  export interface WorkoutPlanDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['WorkoutPlan'], meta: { name: 'WorkoutPlan' } }
    /**
     * Find zero or one WorkoutPlan that matches the filter.
     * @param {WorkoutPlanFindUniqueArgs} args - Arguments to find a WorkoutPlan
     * @example
     * // Get one WorkoutPlan
     * const workoutPlan = await prisma.workoutPlan.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends WorkoutPlanFindUniqueArgs>(args: SelectSubset<T, WorkoutPlanFindUniqueArgs<ExtArgs>>): Prisma__WorkoutPlanClient<$Result.GetResult<Prisma.$WorkoutPlanPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one WorkoutPlan that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {WorkoutPlanFindUniqueOrThrowArgs} args - Arguments to find a WorkoutPlan
     * @example
     * // Get one WorkoutPlan
     * const workoutPlan = await prisma.workoutPlan.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends WorkoutPlanFindUniqueOrThrowArgs>(args: SelectSubset<T, WorkoutPlanFindUniqueOrThrowArgs<ExtArgs>>): Prisma__WorkoutPlanClient<$Result.GetResult<Prisma.$WorkoutPlanPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first WorkoutPlan that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutPlanFindFirstArgs} args - Arguments to find a WorkoutPlan
     * @example
     * // Get one WorkoutPlan
     * const workoutPlan = await prisma.workoutPlan.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends WorkoutPlanFindFirstArgs>(args?: SelectSubset<T, WorkoutPlanFindFirstArgs<ExtArgs>>): Prisma__WorkoutPlanClient<$Result.GetResult<Prisma.$WorkoutPlanPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first WorkoutPlan that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutPlanFindFirstOrThrowArgs} args - Arguments to find a WorkoutPlan
     * @example
     * // Get one WorkoutPlan
     * const workoutPlan = await prisma.workoutPlan.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends WorkoutPlanFindFirstOrThrowArgs>(args?: SelectSubset<T, WorkoutPlanFindFirstOrThrowArgs<ExtArgs>>): Prisma__WorkoutPlanClient<$Result.GetResult<Prisma.$WorkoutPlanPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more WorkoutPlans that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutPlanFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all WorkoutPlans
     * const workoutPlans = await prisma.workoutPlan.findMany()
     * 
     * // Get first 10 WorkoutPlans
     * const workoutPlans = await prisma.workoutPlan.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const workoutPlanWithIdOnly = await prisma.workoutPlan.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends WorkoutPlanFindManyArgs>(args?: SelectSubset<T, WorkoutPlanFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$WorkoutPlanPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a WorkoutPlan.
     * @param {WorkoutPlanCreateArgs} args - Arguments to create a WorkoutPlan.
     * @example
     * // Create one WorkoutPlan
     * const WorkoutPlan = await prisma.workoutPlan.create({
     *   data: {
     *     // ... data to create a WorkoutPlan
     *   }
     * })
     * 
     */
    create<T extends WorkoutPlanCreateArgs>(args: SelectSubset<T, WorkoutPlanCreateArgs<ExtArgs>>): Prisma__WorkoutPlanClient<$Result.GetResult<Prisma.$WorkoutPlanPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many WorkoutPlans.
     * @param {WorkoutPlanCreateManyArgs} args - Arguments to create many WorkoutPlans.
     * @example
     * // Create many WorkoutPlans
     * const workoutPlan = await prisma.workoutPlan.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends WorkoutPlanCreateManyArgs>(args?: SelectSubset<T, WorkoutPlanCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many WorkoutPlans and returns the data saved in the database.
     * @param {WorkoutPlanCreateManyAndReturnArgs} args - Arguments to create many WorkoutPlans.
     * @example
     * // Create many WorkoutPlans
     * const workoutPlan = await prisma.workoutPlan.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many WorkoutPlans and only return the `id`
     * const workoutPlanWithIdOnly = await prisma.workoutPlan.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends WorkoutPlanCreateManyAndReturnArgs>(args?: SelectSubset<T, WorkoutPlanCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$WorkoutPlanPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a WorkoutPlan.
     * @param {WorkoutPlanDeleteArgs} args - Arguments to delete one WorkoutPlan.
     * @example
     * // Delete one WorkoutPlan
     * const WorkoutPlan = await prisma.workoutPlan.delete({
     *   where: {
     *     // ... filter to delete one WorkoutPlan
     *   }
     * })
     * 
     */
    delete<T extends WorkoutPlanDeleteArgs>(args: SelectSubset<T, WorkoutPlanDeleteArgs<ExtArgs>>): Prisma__WorkoutPlanClient<$Result.GetResult<Prisma.$WorkoutPlanPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one WorkoutPlan.
     * @param {WorkoutPlanUpdateArgs} args - Arguments to update one WorkoutPlan.
     * @example
     * // Update one WorkoutPlan
     * const workoutPlan = await prisma.workoutPlan.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends WorkoutPlanUpdateArgs>(args: SelectSubset<T, WorkoutPlanUpdateArgs<ExtArgs>>): Prisma__WorkoutPlanClient<$Result.GetResult<Prisma.$WorkoutPlanPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more WorkoutPlans.
     * @param {WorkoutPlanDeleteManyArgs} args - Arguments to filter WorkoutPlans to delete.
     * @example
     * // Delete a few WorkoutPlans
     * const { count } = await prisma.workoutPlan.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends WorkoutPlanDeleteManyArgs>(args?: SelectSubset<T, WorkoutPlanDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more WorkoutPlans.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutPlanUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many WorkoutPlans
     * const workoutPlan = await prisma.workoutPlan.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends WorkoutPlanUpdateManyArgs>(args: SelectSubset<T, WorkoutPlanUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one WorkoutPlan.
     * @param {WorkoutPlanUpsertArgs} args - Arguments to update or create a WorkoutPlan.
     * @example
     * // Update or create a WorkoutPlan
     * const workoutPlan = await prisma.workoutPlan.upsert({
     *   create: {
     *     // ... data to create a WorkoutPlan
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the WorkoutPlan we want to update
     *   }
     * })
     */
    upsert<T extends WorkoutPlanUpsertArgs>(args: SelectSubset<T, WorkoutPlanUpsertArgs<ExtArgs>>): Prisma__WorkoutPlanClient<$Result.GetResult<Prisma.$WorkoutPlanPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of WorkoutPlans.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutPlanCountArgs} args - Arguments to filter WorkoutPlans to count.
     * @example
     * // Count the number of WorkoutPlans
     * const count = await prisma.workoutPlan.count({
     *   where: {
     *     // ... the filter for the WorkoutPlans we want to count
     *   }
     * })
    **/
    count<T extends WorkoutPlanCountArgs>(
      args?: Subset<T, WorkoutPlanCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], WorkoutPlanCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a WorkoutPlan.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutPlanAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends WorkoutPlanAggregateArgs>(args: Subset<T, WorkoutPlanAggregateArgs>): Prisma.PrismaPromise<GetWorkoutPlanAggregateType<T>>

    /**
     * Group by WorkoutPlan.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutPlanGroupByArgs} args - Group by arguments.
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
      T extends WorkoutPlanGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: WorkoutPlanGroupByArgs['orderBy'] }
        : { orderBy?: WorkoutPlanGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, WorkoutPlanGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetWorkoutPlanGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the WorkoutPlan model
   */
  readonly fields: WorkoutPlanFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for WorkoutPlan.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__WorkoutPlanClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    publishedListings<T extends WorkoutPlan$publishedListingsArgs<ExtArgs> = {}>(args?: Subset<T, WorkoutPlan$publishedListingsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PublishedPlanPayload<ExtArgs>, T, "findMany"> | Null>
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
   * Fields of the WorkoutPlan model
   */ 
  interface WorkoutPlanFieldRefs {
    readonly id: FieldRef<"WorkoutPlan", 'String'>
    readonly userId: FieldRef<"WorkoutPlan", 'String'>
    readonly name: FieldRef<"WorkoutPlan", 'String'>
    readonly description: FieldRef<"WorkoutPlan", 'String'>
    readonly goal: FieldRef<"WorkoutPlan", 'String'>
    readonly duration: FieldRef<"WorkoutPlan", 'Int'>
    readonly daysPerWeek: FieldRef<"WorkoutPlan", 'Int'>
    readonly plan: FieldRef<"WorkoutPlan", 'Json'>
    readonly status: FieldRef<"WorkoutPlan", 'PlanStatus'>
    readonly version: FieldRef<"WorkoutPlan", 'Int'>
    readonly jobId: FieldRef<"WorkoutPlan", 'String'>
    readonly failReason: FieldRef<"WorkoutPlan", 'String'>
    readonly ptUserId: FieldRef<"WorkoutPlan", 'String'>
    readonly ptName: FieldRef<"WorkoutPlan", 'String'>
    readonly clientName: FieldRef<"WorkoutPlan", 'String'>
    readonly ptReviewStatus: FieldRef<"WorkoutPlan", 'PtReviewStatus'>
    readonly ptNote: FieldRef<"WorkoutPlan", 'String'>
    readonly ptReviewedAt: FieldRef<"WorkoutPlan", 'DateTime'>
    readonly archivedAt: FieldRef<"WorkoutPlan", 'DateTime'>
    readonly createdAt: FieldRef<"WorkoutPlan", 'DateTime'>
    readonly updatedAt: FieldRef<"WorkoutPlan", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * WorkoutPlan findUnique
   */
  export type WorkoutPlanFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutPlan
     */
    select?: WorkoutPlanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutPlanInclude<ExtArgs> | null
    /**
     * Filter, which WorkoutPlan to fetch.
     */
    where: WorkoutPlanWhereUniqueInput
  }

  /**
   * WorkoutPlan findUniqueOrThrow
   */
  export type WorkoutPlanFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutPlan
     */
    select?: WorkoutPlanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutPlanInclude<ExtArgs> | null
    /**
     * Filter, which WorkoutPlan to fetch.
     */
    where: WorkoutPlanWhereUniqueInput
  }

  /**
   * WorkoutPlan findFirst
   */
  export type WorkoutPlanFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutPlan
     */
    select?: WorkoutPlanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutPlanInclude<ExtArgs> | null
    /**
     * Filter, which WorkoutPlan to fetch.
     */
    where?: WorkoutPlanWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of WorkoutPlans to fetch.
     */
    orderBy?: WorkoutPlanOrderByWithRelationInput | WorkoutPlanOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for WorkoutPlans.
     */
    cursor?: WorkoutPlanWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` WorkoutPlans from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` WorkoutPlans.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of WorkoutPlans.
     */
    distinct?: WorkoutPlanScalarFieldEnum | WorkoutPlanScalarFieldEnum[]
  }

  /**
   * WorkoutPlan findFirstOrThrow
   */
  export type WorkoutPlanFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutPlan
     */
    select?: WorkoutPlanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutPlanInclude<ExtArgs> | null
    /**
     * Filter, which WorkoutPlan to fetch.
     */
    where?: WorkoutPlanWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of WorkoutPlans to fetch.
     */
    orderBy?: WorkoutPlanOrderByWithRelationInput | WorkoutPlanOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for WorkoutPlans.
     */
    cursor?: WorkoutPlanWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` WorkoutPlans from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` WorkoutPlans.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of WorkoutPlans.
     */
    distinct?: WorkoutPlanScalarFieldEnum | WorkoutPlanScalarFieldEnum[]
  }

  /**
   * WorkoutPlan findMany
   */
  export type WorkoutPlanFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutPlan
     */
    select?: WorkoutPlanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutPlanInclude<ExtArgs> | null
    /**
     * Filter, which WorkoutPlans to fetch.
     */
    where?: WorkoutPlanWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of WorkoutPlans to fetch.
     */
    orderBy?: WorkoutPlanOrderByWithRelationInput | WorkoutPlanOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing WorkoutPlans.
     */
    cursor?: WorkoutPlanWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` WorkoutPlans from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` WorkoutPlans.
     */
    skip?: number
    distinct?: WorkoutPlanScalarFieldEnum | WorkoutPlanScalarFieldEnum[]
  }

  /**
   * WorkoutPlan create
   */
  export type WorkoutPlanCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutPlan
     */
    select?: WorkoutPlanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutPlanInclude<ExtArgs> | null
    /**
     * The data needed to create a WorkoutPlan.
     */
    data: XOR<WorkoutPlanCreateInput, WorkoutPlanUncheckedCreateInput>
  }

  /**
   * WorkoutPlan createMany
   */
  export type WorkoutPlanCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many WorkoutPlans.
     */
    data: WorkoutPlanCreateManyInput | WorkoutPlanCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * WorkoutPlan createManyAndReturn
   */
  export type WorkoutPlanCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutPlan
     */
    select?: WorkoutPlanSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many WorkoutPlans.
     */
    data: WorkoutPlanCreateManyInput | WorkoutPlanCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * WorkoutPlan update
   */
  export type WorkoutPlanUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutPlan
     */
    select?: WorkoutPlanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutPlanInclude<ExtArgs> | null
    /**
     * The data needed to update a WorkoutPlan.
     */
    data: XOR<WorkoutPlanUpdateInput, WorkoutPlanUncheckedUpdateInput>
    /**
     * Choose, which WorkoutPlan to update.
     */
    where: WorkoutPlanWhereUniqueInput
  }

  /**
   * WorkoutPlan updateMany
   */
  export type WorkoutPlanUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update WorkoutPlans.
     */
    data: XOR<WorkoutPlanUpdateManyMutationInput, WorkoutPlanUncheckedUpdateManyInput>
    /**
     * Filter which WorkoutPlans to update
     */
    where?: WorkoutPlanWhereInput
  }

  /**
   * WorkoutPlan upsert
   */
  export type WorkoutPlanUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutPlan
     */
    select?: WorkoutPlanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutPlanInclude<ExtArgs> | null
    /**
     * The filter to search for the WorkoutPlan to update in case it exists.
     */
    where: WorkoutPlanWhereUniqueInput
    /**
     * In case the WorkoutPlan found by the `where` argument doesn't exist, create a new WorkoutPlan with this data.
     */
    create: XOR<WorkoutPlanCreateInput, WorkoutPlanUncheckedCreateInput>
    /**
     * In case the WorkoutPlan was found with the provided `where` argument, update it with this data.
     */
    update: XOR<WorkoutPlanUpdateInput, WorkoutPlanUncheckedUpdateInput>
  }

  /**
   * WorkoutPlan delete
   */
  export type WorkoutPlanDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutPlan
     */
    select?: WorkoutPlanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutPlanInclude<ExtArgs> | null
    /**
     * Filter which WorkoutPlan to delete.
     */
    where: WorkoutPlanWhereUniqueInput
  }

  /**
   * WorkoutPlan deleteMany
   */
  export type WorkoutPlanDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which WorkoutPlans to delete
     */
    where?: WorkoutPlanWhereInput
  }

  /**
   * WorkoutPlan.publishedListings
   */
  export type WorkoutPlan$publishedListingsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PublishedPlan
     */
    select?: PublishedPlanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PublishedPlanInclude<ExtArgs> | null
    where?: PublishedPlanWhereInput
    orderBy?: PublishedPlanOrderByWithRelationInput | PublishedPlanOrderByWithRelationInput[]
    cursor?: PublishedPlanWhereUniqueInput
    take?: number
    skip?: number
    distinct?: PublishedPlanScalarFieldEnum | PublishedPlanScalarFieldEnum[]
  }

  /**
   * WorkoutPlan without action
   */
  export type WorkoutPlanDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutPlan
     */
    select?: WorkoutPlanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutPlanInclude<ExtArgs> | null
  }


  /**
   * Model PublishedPlan
   */

  export type AggregatePublishedPlan = {
    _count: PublishedPlanCountAggregateOutputType | null
    _avg: PublishedPlanAvgAggregateOutputType | null
    _sum: PublishedPlanSumAggregateOutputType | null
    _min: PublishedPlanMinAggregateOutputType | null
    _max: PublishedPlanMaxAggregateOutputType | null
  }

  export type PublishedPlanAvgAggregateOutputType = {
    avgRating: number | null
    ratingCount: number | null
  }

  export type PublishedPlanSumAggregateOutputType = {
    avgRating: number | null
    ratingCount: number | null
  }

  export type PublishedPlanMinAggregateOutputType = {
    id: string | null
    sourcePlanId: string | null
    publisherId: string | null
    title: string | null
    description: string | null
    goal: string | null
    moderationStatus: $Enums.PublishModerationStatus | null
    moderationNote: string | null
    avgRating: number | null
    ratingCount: number | null
    publishedAt: Date | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type PublishedPlanMaxAggregateOutputType = {
    id: string | null
    sourcePlanId: string | null
    publisherId: string | null
    title: string | null
    description: string | null
    goal: string | null
    moderationStatus: $Enums.PublishModerationStatus | null
    moderationNote: string | null
    avgRating: number | null
    ratingCount: number | null
    publishedAt: Date | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type PublishedPlanCountAggregateOutputType = {
    id: number
    sourcePlanId: number
    publisherId: number
    title: number
    description: number
    goal: number
    moderationStatus: number
    moderationNote: number
    avgRating: number
    ratingCount: number
    publishedAt: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type PublishedPlanAvgAggregateInputType = {
    avgRating?: true
    ratingCount?: true
  }

  export type PublishedPlanSumAggregateInputType = {
    avgRating?: true
    ratingCount?: true
  }

  export type PublishedPlanMinAggregateInputType = {
    id?: true
    sourcePlanId?: true
    publisherId?: true
    title?: true
    description?: true
    goal?: true
    moderationStatus?: true
    moderationNote?: true
    avgRating?: true
    ratingCount?: true
    publishedAt?: true
    createdAt?: true
    updatedAt?: true
  }

  export type PublishedPlanMaxAggregateInputType = {
    id?: true
    sourcePlanId?: true
    publisherId?: true
    title?: true
    description?: true
    goal?: true
    moderationStatus?: true
    moderationNote?: true
    avgRating?: true
    ratingCount?: true
    publishedAt?: true
    createdAt?: true
    updatedAt?: true
  }

  export type PublishedPlanCountAggregateInputType = {
    id?: true
    sourcePlanId?: true
    publisherId?: true
    title?: true
    description?: true
    goal?: true
    moderationStatus?: true
    moderationNote?: true
    avgRating?: true
    ratingCount?: true
    publishedAt?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type PublishedPlanAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which PublishedPlan to aggregate.
     */
    where?: PublishedPlanWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PublishedPlans to fetch.
     */
    orderBy?: PublishedPlanOrderByWithRelationInput | PublishedPlanOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: PublishedPlanWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PublishedPlans from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PublishedPlans.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned PublishedPlans
    **/
    _count?: true | PublishedPlanCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: PublishedPlanAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: PublishedPlanSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: PublishedPlanMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: PublishedPlanMaxAggregateInputType
  }

  export type GetPublishedPlanAggregateType<T extends PublishedPlanAggregateArgs> = {
        [P in keyof T & keyof AggregatePublishedPlan]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregatePublishedPlan[P]>
      : GetScalarType<T[P], AggregatePublishedPlan[P]>
  }




  export type PublishedPlanGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: PublishedPlanWhereInput
    orderBy?: PublishedPlanOrderByWithAggregationInput | PublishedPlanOrderByWithAggregationInput[]
    by: PublishedPlanScalarFieldEnum[] | PublishedPlanScalarFieldEnum
    having?: PublishedPlanScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: PublishedPlanCountAggregateInputType | true
    _avg?: PublishedPlanAvgAggregateInputType
    _sum?: PublishedPlanSumAggregateInputType
    _min?: PublishedPlanMinAggregateInputType
    _max?: PublishedPlanMaxAggregateInputType
  }

  export type PublishedPlanGroupByOutputType = {
    id: string
    sourcePlanId: string
    publisherId: string
    title: string
    description: string | null
    goal: string
    moderationStatus: $Enums.PublishModerationStatus
    moderationNote: string | null
    avgRating: number
    ratingCount: number
    publishedAt: Date | null
    createdAt: Date
    updatedAt: Date
    _count: PublishedPlanCountAggregateOutputType | null
    _avg: PublishedPlanAvgAggregateOutputType | null
    _sum: PublishedPlanSumAggregateOutputType | null
    _min: PublishedPlanMinAggregateOutputType | null
    _max: PublishedPlanMaxAggregateOutputType | null
  }

  type GetPublishedPlanGroupByPayload<T extends PublishedPlanGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<PublishedPlanGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof PublishedPlanGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], PublishedPlanGroupByOutputType[P]>
            : GetScalarType<T[P], PublishedPlanGroupByOutputType[P]>
        }
      >
    >


  export type PublishedPlanSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    sourcePlanId?: boolean
    publisherId?: boolean
    title?: boolean
    description?: boolean
    goal?: boolean
    moderationStatus?: boolean
    moderationNote?: boolean
    avgRating?: boolean
    ratingCount?: boolean
    publishedAt?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    sourcePlan?: boolean | WorkoutPlanDefaultArgs<ExtArgs>
    reviews?: boolean | PublishedPlan$reviewsArgs<ExtArgs>
    packages?: boolean | PublishedPlan$packagesArgs<ExtArgs>
    _count?: boolean | PublishedPlanCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["publishedPlan"]>

  export type PublishedPlanSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    sourcePlanId?: boolean
    publisherId?: boolean
    title?: boolean
    description?: boolean
    goal?: boolean
    moderationStatus?: boolean
    moderationNote?: boolean
    avgRating?: boolean
    ratingCount?: boolean
    publishedAt?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    sourcePlan?: boolean | WorkoutPlanDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["publishedPlan"]>

  export type PublishedPlanSelectScalar = {
    id?: boolean
    sourcePlanId?: boolean
    publisherId?: boolean
    title?: boolean
    description?: boolean
    goal?: boolean
    moderationStatus?: boolean
    moderationNote?: boolean
    avgRating?: boolean
    ratingCount?: boolean
    publishedAt?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type PublishedPlanInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    sourcePlan?: boolean | WorkoutPlanDefaultArgs<ExtArgs>
    reviews?: boolean | PublishedPlan$reviewsArgs<ExtArgs>
    packages?: boolean | PublishedPlan$packagesArgs<ExtArgs>
    _count?: boolean | PublishedPlanCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type PublishedPlanIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    sourcePlan?: boolean | WorkoutPlanDefaultArgs<ExtArgs>
  }

  export type $PublishedPlanPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "PublishedPlan"
    objects: {
      sourcePlan: Prisma.$WorkoutPlanPayload<ExtArgs>
      reviews: Prisma.$PlanReviewPayload<ExtArgs>[]
      packages: Prisma.$TrainingPackagePayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      sourcePlanId: string
      publisherId: string
      title: string
      description: string | null
      goal: string
      moderationStatus: $Enums.PublishModerationStatus
      moderationNote: string | null
      avgRating: number
      ratingCount: number
      publishedAt: Date | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["publishedPlan"]>
    composites: {}
  }

  type PublishedPlanGetPayload<S extends boolean | null | undefined | PublishedPlanDefaultArgs> = $Result.GetResult<Prisma.$PublishedPlanPayload, S>

  type PublishedPlanCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<PublishedPlanFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: PublishedPlanCountAggregateInputType | true
    }

  export interface PublishedPlanDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['PublishedPlan'], meta: { name: 'PublishedPlan' } }
    /**
     * Find zero or one PublishedPlan that matches the filter.
     * @param {PublishedPlanFindUniqueArgs} args - Arguments to find a PublishedPlan
     * @example
     * // Get one PublishedPlan
     * const publishedPlan = await prisma.publishedPlan.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends PublishedPlanFindUniqueArgs>(args: SelectSubset<T, PublishedPlanFindUniqueArgs<ExtArgs>>): Prisma__PublishedPlanClient<$Result.GetResult<Prisma.$PublishedPlanPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one PublishedPlan that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {PublishedPlanFindUniqueOrThrowArgs} args - Arguments to find a PublishedPlan
     * @example
     * // Get one PublishedPlan
     * const publishedPlan = await prisma.publishedPlan.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends PublishedPlanFindUniqueOrThrowArgs>(args: SelectSubset<T, PublishedPlanFindUniqueOrThrowArgs<ExtArgs>>): Prisma__PublishedPlanClient<$Result.GetResult<Prisma.$PublishedPlanPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first PublishedPlan that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PublishedPlanFindFirstArgs} args - Arguments to find a PublishedPlan
     * @example
     * // Get one PublishedPlan
     * const publishedPlan = await prisma.publishedPlan.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends PublishedPlanFindFirstArgs>(args?: SelectSubset<T, PublishedPlanFindFirstArgs<ExtArgs>>): Prisma__PublishedPlanClient<$Result.GetResult<Prisma.$PublishedPlanPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first PublishedPlan that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PublishedPlanFindFirstOrThrowArgs} args - Arguments to find a PublishedPlan
     * @example
     * // Get one PublishedPlan
     * const publishedPlan = await prisma.publishedPlan.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends PublishedPlanFindFirstOrThrowArgs>(args?: SelectSubset<T, PublishedPlanFindFirstOrThrowArgs<ExtArgs>>): Prisma__PublishedPlanClient<$Result.GetResult<Prisma.$PublishedPlanPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more PublishedPlans that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PublishedPlanFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all PublishedPlans
     * const publishedPlans = await prisma.publishedPlan.findMany()
     * 
     * // Get first 10 PublishedPlans
     * const publishedPlans = await prisma.publishedPlan.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const publishedPlanWithIdOnly = await prisma.publishedPlan.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends PublishedPlanFindManyArgs>(args?: SelectSubset<T, PublishedPlanFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PublishedPlanPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a PublishedPlan.
     * @param {PublishedPlanCreateArgs} args - Arguments to create a PublishedPlan.
     * @example
     * // Create one PublishedPlan
     * const PublishedPlan = await prisma.publishedPlan.create({
     *   data: {
     *     // ... data to create a PublishedPlan
     *   }
     * })
     * 
     */
    create<T extends PublishedPlanCreateArgs>(args: SelectSubset<T, PublishedPlanCreateArgs<ExtArgs>>): Prisma__PublishedPlanClient<$Result.GetResult<Prisma.$PublishedPlanPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many PublishedPlans.
     * @param {PublishedPlanCreateManyArgs} args - Arguments to create many PublishedPlans.
     * @example
     * // Create many PublishedPlans
     * const publishedPlan = await prisma.publishedPlan.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends PublishedPlanCreateManyArgs>(args?: SelectSubset<T, PublishedPlanCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many PublishedPlans and returns the data saved in the database.
     * @param {PublishedPlanCreateManyAndReturnArgs} args - Arguments to create many PublishedPlans.
     * @example
     * // Create many PublishedPlans
     * const publishedPlan = await prisma.publishedPlan.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many PublishedPlans and only return the `id`
     * const publishedPlanWithIdOnly = await prisma.publishedPlan.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends PublishedPlanCreateManyAndReturnArgs>(args?: SelectSubset<T, PublishedPlanCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PublishedPlanPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a PublishedPlan.
     * @param {PublishedPlanDeleteArgs} args - Arguments to delete one PublishedPlan.
     * @example
     * // Delete one PublishedPlan
     * const PublishedPlan = await prisma.publishedPlan.delete({
     *   where: {
     *     // ... filter to delete one PublishedPlan
     *   }
     * })
     * 
     */
    delete<T extends PublishedPlanDeleteArgs>(args: SelectSubset<T, PublishedPlanDeleteArgs<ExtArgs>>): Prisma__PublishedPlanClient<$Result.GetResult<Prisma.$PublishedPlanPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one PublishedPlan.
     * @param {PublishedPlanUpdateArgs} args - Arguments to update one PublishedPlan.
     * @example
     * // Update one PublishedPlan
     * const publishedPlan = await prisma.publishedPlan.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends PublishedPlanUpdateArgs>(args: SelectSubset<T, PublishedPlanUpdateArgs<ExtArgs>>): Prisma__PublishedPlanClient<$Result.GetResult<Prisma.$PublishedPlanPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more PublishedPlans.
     * @param {PublishedPlanDeleteManyArgs} args - Arguments to filter PublishedPlans to delete.
     * @example
     * // Delete a few PublishedPlans
     * const { count } = await prisma.publishedPlan.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends PublishedPlanDeleteManyArgs>(args?: SelectSubset<T, PublishedPlanDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more PublishedPlans.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PublishedPlanUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many PublishedPlans
     * const publishedPlan = await prisma.publishedPlan.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends PublishedPlanUpdateManyArgs>(args: SelectSubset<T, PublishedPlanUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one PublishedPlan.
     * @param {PublishedPlanUpsertArgs} args - Arguments to update or create a PublishedPlan.
     * @example
     * // Update or create a PublishedPlan
     * const publishedPlan = await prisma.publishedPlan.upsert({
     *   create: {
     *     // ... data to create a PublishedPlan
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the PublishedPlan we want to update
     *   }
     * })
     */
    upsert<T extends PublishedPlanUpsertArgs>(args: SelectSubset<T, PublishedPlanUpsertArgs<ExtArgs>>): Prisma__PublishedPlanClient<$Result.GetResult<Prisma.$PublishedPlanPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of PublishedPlans.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PublishedPlanCountArgs} args - Arguments to filter PublishedPlans to count.
     * @example
     * // Count the number of PublishedPlans
     * const count = await prisma.publishedPlan.count({
     *   where: {
     *     // ... the filter for the PublishedPlans we want to count
     *   }
     * })
    **/
    count<T extends PublishedPlanCountArgs>(
      args?: Subset<T, PublishedPlanCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], PublishedPlanCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a PublishedPlan.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PublishedPlanAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends PublishedPlanAggregateArgs>(args: Subset<T, PublishedPlanAggregateArgs>): Prisma.PrismaPromise<GetPublishedPlanAggregateType<T>>

    /**
     * Group by PublishedPlan.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PublishedPlanGroupByArgs} args - Group by arguments.
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
      T extends PublishedPlanGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: PublishedPlanGroupByArgs['orderBy'] }
        : { orderBy?: PublishedPlanGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, PublishedPlanGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetPublishedPlanGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the PublishedPlan model
   */
  readonly fields: PublishedPlanFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for PublishedPlan.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__PublishedPlanClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    sourcePlan<T extends WorkoutPlanDefaultArgs<ExtArgs> = {}>(args?: Subset<T, WorkoutPlanDefaultArgs<ExtArgs>>): Prisma__WorkoutPlanClient<$Result.GetResult<Prisma.$WorkoutPlanPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
    reviews<T extends PublishedPlan$reviewsArgs<ExtArgs> = {}>(args?: Subset<T, PublishedPlan$reviewsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PlanReviewPayload<ExtArgs>, T, "findMany"> | Null>
    packages<T extends PublishedPlan$packagesArgs<ExtArgs> = {}>(args?: Subset<T, PublishedPlan$packagesArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$TrainingPackagePayload<ExtArgs>, T, "findMany"> | Null>
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
   * Fields of the PublishedPlan model
   */ 
  interface PublishedPlanFieldRefs {
    readonly id: FieldRef<"PublishedPlan", 'String'>
    readonly sourcePlanId: FieldRef<"PublishedPlan", 'String'>
    readonly publisherId: FieldRef<"PublishedPlan", 'String'>
    readonly title: FieldRef<"PublishedPlan", 'String'>
    readonly description: FieldRef<"PublishedPlan", 'String'>
    readonly goal: FieldRef<"PublishedPlan", 'String'>
    readonly moderationStatus: FieldRef<"PublishedPlan", 'PublishModerationStatus'>
    readonly moderationNote: FieldRef<"PublishedPlan", 'String'>
    readonly avgRating: FieldRef<"PublishedPlan", 'Float'>
    readonly ratingCount: FieldRef<"PublishedPlan", 'Int'>
    readonly publishedAt: FieldRef<"PublishedPlan", 'DateTime'>
    readonly createdAt: FieldRef<"PublishedPlan", 'DateTime'>
    readonly updatedAt: FieldRef<"PublishedPlan", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * PublishedPlan findUnique
   */
  export type PublishedPlanFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PublishedPlan
     */
    select?: PublishedPlanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PublishedPlanInclude<ExtArgs> | null
    /**
     * Filter, which PublishedPlan to fetch.
     */
    where: PublishedPlanWhereUniqueInput
  }

  /**
   * PublishedPlan findUniqueOrThrow
   */
  export type PublishedPlanFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PublishedPlan
     */
    select?: PublishedPlanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PublishedPlanInclude<ExtArgs> | null
    /**
     * Filter, which PublishedPlan to fetch.
     */
    where: PublishedPlanWhereUniqueInput
  }

  /**
   * PublishedPlan findFirst
   */
  export type PublishedPlanFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PublishedPlan
     */
    select?: PublishedPlanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PublishedPlanInclude<ExtArgs> | null
    /**
     * Filter, which PublishedPlan to fetch.
     */
    where?: PublishedPlanWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PublishedPlans to fetch.
     */
    orderBy?: PublishedPlanOrderByWithRelationInput | PublishedPlanOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for PublishedPlans.
     */
    cursor?: PublishedPlanWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PublishedPlans from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PublishedPlans.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of PublishedPlans.
     */
    distinct?: PublishedPlanScalarFieldEnum | PublishedPlanScalarFieldEnum[]
  }

  /**
   * PublishedPlan findFirstOrThrow
   */
  export type PublishedPlanFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PublishedPlan
     */
    select?: PublishedPlanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PublishedPlanInclude<ExtArgs> | null
    /**
     * Filter, which PublishedPlan to fetch.
     */
    where?: PublishedPlanWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PublishedPlans to fetch.
     */
    orderBy?: PublishedPlanOrderByWithRelationInput | PublishedPlanOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for PublishedPlans.
     */
    cursor?: PublishedPlanWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PublishedPlans from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PublishedPlans.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of PublishedPlans.
     */
    distinct?: PublishedPlanScalarFieldEnum | PublishedPlanScalarFieldEnum[]
  }

  /**
   * PublishedPlan findMany
   */
  export type PublishedPlanFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PublishedPlan
     */
    select?: PublishedPlanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PublishedPlanInclude<ExtArgs> | null
    /**
     * Filter, which PublishedPlans to fetch.
     */
    where?: PublishedPlanWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PublishedPlans to fetch.
     */
    orderBy?: PublishedPlanOrderByWithRelationInput | PublishedPlanOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing PublishedPlans.
     */
    cursor?: PublishedPlanWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PublishedPlans from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PublishedPlans.
     */
    skip?: number
    distinct?: PublishedPlanScalarFieldEnum | PublishedPlanScalarFieldEnum[]
  }

  /**
   * PublishedPlan create
   */
  export type PublishedPlanCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PublishedPlan
     */
    select?: PublishedPlanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PublishedPlanInclude<ExtArgs> | null
    /**
     * The data needed to create a PublishedPlan.
     */
    data: XOR<PublishedPlanCreateInput, PublishedPlanUncheckedCreateInput>
  }

  /**
   * PublishedPlan createMany
   */
  export type PublishedPlanCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many PublishedPlans.
     */
    data: PublishedPlanCreateManyInput | PublishedPlanCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * PublishedPlan createManyAndReturn
   */
  export type PublishedPlanCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PublishedPlan
     */
    select?: PublishedPlanSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many PublishedPlans.
     */
    data: PublishedPlanCreateManyInput | PublishedPlanCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PublishedPlanIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * PublishedPlan update
   */
  export type PublishedPlanUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PublishedPlan
     */
    select?: PublishedPlanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PublishedPlanInclude<ExtArgs> | null
    /**
     * The data needed to update a PublishedPlan.
     */
    data: XOR<PublishedPlanUpdateInput, PublishedPlanUncheckedUpdateInput>
    /**
     * Choose, which PublishedPlan to update.
     */
    where: PublishedPlanWhereUniqueInput
  }

  /**
   * PublishedPlan updateMany
   */
  export type PublishedPlanUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update PublishedPlans.
     */
    data: XOR<PublishedPlanUpdateManyMutationInput, PublishedPlanUncheckedUpdateManyInput>
    /**
     * Filter which PublishedPlans to update
     */
    where?: PublishedPlanWhereInput
  }

  /**
   * PublishedPlan upsert
   */
  export type PublishedPlanUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PublishedPlan
     */
    select?: PublishedPlanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PublishedPlanInclude<ExtArgs> | null
    /**
     * The filter to search for the PublishedPlan to update in case it exists.
     */
    where: PublishedPlanWhereUniqueInput
    /**
     * In case the PublishedPlan found by the `where` argument doesn't exist, create a new PublishedPlan with this data.
     */
    create: XOR<PublishedPlanCreateInput, PublishedPlanUncheckedCreateInput>
    /**
     * In case the PublishedPlan was found with the provided `where` argument, update it with this data.
     */
    update: XOR<PublishedPlanUpdateInput, PublishedPlanUncheckedUpdateInput>
  }

  /**
   * PublishedPlan delete
   */
  export type PublishedPlanDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PublishedPlan
     */
    select?: PublishedPlanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PublishedPlanInclude<ExtArgs> | null
    /**
     * Filter which PublishedPlan to delete.
     */
    where: PublishedPlanWhereUniqueInput
  }

  /**
   * PublishedPlan deleteMany
   */
  export type PublishedPlanDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which PublishedPlans to delete
     */
    where?: PublishedPlanWhereInput
  }

  /**
   * PublishedPlan.reviews
   */
  export type PublishedPlan$reviewsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PlanReview
     */
    select?: PlanReviewSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PlanReviewInclude<ExtArgs> | null
    where?: PlanReviewWhereInput
    orderBy?: PlanReviewOrderByWithRelationInput | PlanReviewOrderByWithRelationInput[]
    cursor?: PlanReviewWhereUniqueInput
    take?: number
    skip?: number
    distinct?: PlanReviewScalarFieldEnum | PlanReviewScalarFieldEnum[]
  }

  /**
   * PublishedPlan.packages
   */
  export type PublishedPlan$packagesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TrainingPackage
     */
    select?: TrainingPackageSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TrainingPackageInclude<ExtArgs> | null
    where?: TrainingPackageWhereInput
    orderBy?: TrainingPackageOrderByWithRelationInput | TrainingPackageOrderByWithRelationInput[]
    cursor?: TrainingPackageWhereUniqueInput
    take?: number
    skip?: number
    distinct?: TrainingPackageScalarFieldEnum | TrainingPackageScalarFieldEnum[]
  }

  /**
   * PublishedPlan without action
   */
  export type PublishedPlanDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PublishedPlan
     */
    select?: PublishedPlanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PublishedPlanInclude<ExtArgs> | null
  }


  /**
   * Model PlanReview
   */

  export type AggregatePlanReview = {
    _count: PlanReviewCountAggregateOutputType | null
    _avg: PlanReviewAvgAggregateOutputType | null
    _sum: PlanReviewSumAggregateOutputType | null
    _min: PlanReviewMinAggregateOutputType | null
    _max: PlanReviewMaxAggregateOutputType | null
  }

  export type PlanReviewAvgAggregateOutputType = {
    rating: number | null
  }

  export type PlanReviewSumAggregateOutputType = {
    rating: number | null
  }

  export type PlanReviewMinAggregateOutputType = {
    id: string | null
    publishedPlanId: string | null
    reviewerId: string | null
    rating: number | null
    comment: string | null
    createdAt: Date | null
  }

  export type PlanReviewMaxAggregateOutputType = {
    id: string | null
    publishedPlanId: string | null
    reviewerId: string | null
    rating: number | null
    comment: string | null
    createdAt: Date | null
  }

  export type PlanReviewCountAggregateOutputType = {
    id: number
    publishedPlanId: number
    reviewerId: number
    rating: number
    comment: number
    createdAt: number
    _all: number
  }


  export type PlanReviewAvgAggregateInputType = {
    rating?: true
  }

  export type PlanReviewSumAggregateInputType = {
    rating?: true
  }

  export type PlanReviewMinAggregateInputType = {
    id?: true
    publishedPlanId?: true
    reviewerId?: true
    rating?: true
    comment?: true
    createdAt?: true
  }

  export type PlanReviewMaxAggregateInputType = {
    id?: true
    publishedPlanId?: true
    reviewerId?: true
    rating?: true
    comment?: true
    createdAt?: true
  }

  export type PlanReviewCountAggregateInputType = {
    id?: true
    publishedPlanId?: true
    reviewerId?: true
    rating?: true
    comment?: true
    createdAt?: true
    _all?: true
  }

  export type PlanReviewAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which PlanReview to aggregate.
     */
    where?: PlanReviewWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PlanReviews to fetch.
     */
    orderBy?: PlanReviewOrderByWithRelationInput | PlanReviewOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: PlanReviewWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PlanReviews from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PlanReviews.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned PlanReviews
    **/
    _count?: true | PlanReviewCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: PlanReviewAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: PlanReviewSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: PlanReviewMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: PlanReviewMaxAggregateInputType
  }

  export type GetPlanReviewAggregateType<T extends PlanReviewAggregateArgs> = {
        [P in keyof T & keyof AggregatePlanReview]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregatePlanReview[P]>
      : GetScalarType<T[P], AggregatePlanReview[P]>
  }




  export type PlanReviewGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: PlanReviewWhereInput
    orderBy?: PlanReviewOrderByWithAggregationInput | PlanReviewOrderByWithAggregationInput[]
    by: PlanReviewScalarFieldEnum[] | PlanReviewScalarFieldEnum
    having?: PlanReviewScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: PlanReviewCountAggregateInputType | true
    _avg?: PlanReviewAvgAggregateInputType
    _sum?: PlanReviewSumAggregateInputType
    _min?: PlanReviewMinAggregateInputType
    _max?: PlanReviewMaxAggregateInputType
  }

  export type PlanReviewGroupByOutputType = {
    id: string
    publishedPlanId: string
    reviewerId: string
    rating: number
    comment: string | null
    createdAt: Date
    _count: PlanReviewCountAggregateOutputType | null
    _avg: PlanReviewAvgAggregateOutputType | null
    _sum: PlanReviewSumAggregateOutputType | null
    _min: PlanReviewMinAggregateOutputType | null
    _max: PlanReviewMaxAggregateOutputType | null
  }

  type GetPlanReviewGroupByPayload<T extends PlanReviewGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<PlanReviewGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof PlanReviewGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], PlanReviewGroupByOutputType[P]>
            : GetScalarType<T[P], PlanReviewGroupByOutputType[P]>
        }
      >
    >


  export type PlanReviewSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    publishedPlanId?: boolean
    reviewerId?: boolean
    rating?: boolean
    comment?: boolean
    createdAt?: boolean
    publishedPlan?: boolean | PublishedPlanDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["planReview"]>

  export type PlanReviewSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    publishedPlanId?: boolean
    reviewerId?: boolean
    rating?: boolean
    comment?: boolean
    createdAt?: boolean
    publishedPlan?: boolean | PublishedPlanDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["planReview"]>

  export type PlanReviewSelectScalar = {
    id?: boolean
    publishedPlanId?: boolean
    reviewerId?: boolean
    rating?: boolean
    comment?: boolean
    createdAt?: boolean
  }

  export type PlanReviewInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    publishedPlan?: boolean | PublishedPlanDefaultArgs<ExtArgs>
  }
  export type PlanReviewIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    publishedPlan?: boolean | PublishedPlanDefaultArgs<ExtArgs>
  }

  export type $PlanReviewPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "PlanReview"
    objects: {
      publishedPlan: Prisma.$PublishedPlanPayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      publishedPlanId: string
      reviewerId: string
      rating: number
      comment: string | null
      createdAt: Date
    }, ExtArgs["result"]["planReview"]>
    composites: {}
  }

  type PlanReviewGetPayload<S extends boolean | null | undefined | PlanReviewDefaultArgs> = $Result.GetResult<Prisma.$PlanReviewPayload, S>

  type PlanReviewCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<PlanReviewFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: PlanReviewCountAggregateInputType | true
    }

  export interface PlanReviewDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['PlanReview'], meta: { name: 'PlanReview' } }
    /**
     * Find zero or one PlanReview that matches the filter.
     * @param {PlanReviewFindUniqueArgs} args - Arguments to find a PlanReview
     * @example
     * // Get one PlanReview
     * const planReview = await prisma.planReview.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends PlanReviewFindUniqueArgs>(args: SelectSubset<T, PlanReviewFindUniqueArgs<ExtArgs>>): Prisma__PlanReviewClient<$Result.GetResult<Prisma.$PlanReviewPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one PlanReview that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {PlanReviewFindUniqueOrThrowArgs} args - Arguments to find a PlanReview
     * @example
     * // Get one PlanReview
     * const planReview = await prisma.planReview.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends PlanReviewFindUniqueOrThrowArgs>(args: SelectSubset<T, PlanReviewFindUniqueOrThrowArgs<ExtArgs>>): Prisma__PlanReviewClient<$Result.GetResult<Prisma.$PlanReviewPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first PlanReview that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PlanReviewFindFirstArgs} args - Arguments to find a PlanReview
     * @example
     * // Get one PlanReview
     * const planReview = await prisma.planReview.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends PlanReviewFindFirstArgs>(args?: SelectSubset<T, PlanReviewFindFirstArgs<ExtArgs>>): Prisma__PlanReviewClient<$Result.GetResult<Prisma.$PlanReviewPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first PlanReview that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PlanReviewFindFirstOrThrowArgs} args - Arguments to find a PlanReview
     * @example
     * // Get one PlanReview
     * const planReview = await prisma.planReview.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends PlanReviewFindFirstOrThrowArgs>(args?: SelectSubset<T, PlanReviewFindFirstOrThrowArgs<ExtArgs>>): Prisma__PlanReviewClient<$Result.GetResult<Prisma.$PlanReviewPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more PlanReviews that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PlanReviewFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all PlanReviews
     * const planReviews = await prisma.planReview.findMany()
     * 
     * // Get first 10 PlanReviews
     * const planReviews = await prisma.planReview.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const planReviewWithIdOnly = await prisma.planReview.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends PlanReviewFindManyArgs>(args?: SelectSubset<T, PlanReviewFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PlanReviewPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a PlanReview.
     * @param {PlanReviewCreateArgs} args - Arguments to create a PlanReview.
     * @example
     * // Create one PlanReview
     * const PlanReview = await prisma.planReview.create({
     *   data: {
     *     // ... data to create a PlanReview
     *   }
     * })
     * 
     */
    create<T extends PlanReviewCreateArgs>(args: SelectSubset<T, PlanReviewCreateArgs<ExtArgs>>): Prisma__PlanReviewClient<$Result.GetResult<Prisma.$PlanReviewPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many PlanReviews.
     * @param {PlanReviewCreateManyArgs} args - Arguments to create many PlanReviews.
     * @example
     * // Create many PlanReviews
     * const planReview = await prisma.planReview.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends PlanReviewCreateManyArgs>(args?: SelectSubset<T, PlanReviewCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many PlanReviews and returns the data saved in the database.
     * @param {PlanReviewCreateManyAndReturnArgs} args - Arguments to create many PlanReviews.
     * @example
     * // Create many PlanReviews
     * const planReview = await prisma.planReview.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many PlanReviews and only return the `id`
     * const planReviewWithIdOnly = await prisma.planReview.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends PlanReviewCreateManyAndReturnArgs>(args?: SelectSubset<T, PlanReviewCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PlanReviewPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a PlanReview.
     * @param {PlanReviewDeleteArgs} args - Arguments to delete one PlanReview.
     * @example
     * // Delete one PlanReview
     * const PlanReview = await prisma.planReview.delete({
     *   where: {
     *     // ... filter to delete one PlanReview
     *   }
     * })
     * 
     */
    delete<T extends PlanReviewDeleteArgs>(args: SelectSubset<T, PlanReviewDeleteArgs<ExtArgs>>): Prisma__PlanReviewClient<$Result.GetResult<Prisma.$PlanReviewPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one PlanReview.
     * @param {PlanReviewUpdateArgs} args - Arguments to update one PlanReview.
     * @example
     * // Update one PlanReview
     * const planReview = await prisma.planReview.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends PlanReviewUpdateArgs>(args: SelectSubset<T, PlanReviewUpdateArgs<ExtArgs>>): Prisma__PlanReviewClient<$Result.GetResult<Prisma.$PlanReviewPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more PlanReviews.
     * @param {PlanReviewDeleteManyArgs} args - Arguments to filter PlanReviews to delete.
     * @example
     * // Delete a few PlanReviews
     * const { count } = await prisma.planReview.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends PlanReviewDeleteManyArgs>(args?: SelectSubset<T, PlanReviewDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more PlanReviews.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PlanReviewUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many PlanReviews
     * const planReview = await prisma.planReview.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends PlanReviewUpdateManyArgs>(args: SelectSubset<T, PlanReviewUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one PlanReview.
     * @param {PlanReviewUpsertArgs} args - Arguments to update or create a PlanReview.
     * @example
     * // Update or create a PlanReview
     * const planReview = await prisma.planReview.upsert({
     *   create: {
     *     // ... data to create a PlanReview
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the PlanReview we want to update
     *   }
     * })
     */
    upsert<T extends PlanReviewUpsertArgs>(args: SelectSubset<T, PlanReviewUpsertArgs<ExtArgs>>): Prisma__PlanReviewClient<$Result.GetResult<Prisma.$PlanReviewPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of PlanReviews.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PlanReviewCountArgs} args - Arguments to filter PlanReviews to count.
     * @example
     * // Count the number of PlanReviews
     * const count = await prisma.planReview.count({
     *   where: {
     *     // ... the filter for the PlanReviews we want to count
     *   }
     * })
    **/
    count<T extends PlanReviewCountArgs>(
      args?: Subset<T, PlanReviewCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], PlanReviewCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a PlanReview.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PlanReviewAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends PlanReviewAggregateArgs>(args: Subset<T, PlanReviewAggregateArgs>): Prisma.PrismaPromise<GetPlanReviewAggregateType<T>>

    /**
     * Group by PlanReview.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PlanReviewGroupByArgs} args - Group by arguments.
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
      T extends PlanReviewGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: PlanReviewGroupByArgs['orderBy'] }
        : { orderBy?: PlanReviewGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, PlanReviewGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetPlanReviewGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the PlanReview model
   */
  readonly fields: PlanReviewFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for PlanReview.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__PlanReviewClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    publishedPlan<T extends PublishedPlanDefaultArgs<ExtArgs> = {}>(args?: Subset<T, PublishedPlanDefaultArgs<ExtArgs>>): Prisma__PublishedPlanClient<$Result.GetResult<Prisma.$PublishedPlanPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
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
   * Fields of the PlanReview model
   */ 
  interface PlanReviewFieldRefs {
    readonly id: FieldRef<"PlanReview", 'String'>
    readonly publishedPlanId: FieldRef<"PlanReview", 'String'>
    readonly reviewerId: FieldRef<"PlanReview", 'String'>
    readonly rating: FieldRef<"PlanReview", 'Int'>
    readonly comment: FieldRef<"PlanReview", 'String'>
    readonly createdAt: FieldRef<"PlanReview", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * PlanReview findUnique
   */
  export type PlanReviewFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PlanReview
     */
    select?: PlanReviewSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PlanReviewInclude<ExtArgs> | null
    /**
     * Filter, which PlanReview to fetch.
     */
    where: PlanReviewWhereUniqueInput
  }

  /**
   * PlanReview findUniqueOrThrow
   */
  export type PlanReviewFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PlanReview
     */
    select?: PlanReviewSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PlanReviewInclude<ExtArgs> | null
    /**
     * Filter, which PlanReview to fetch.
     */
    where: PlanReviewWhereUniqueInput
  }

  /**
   * PlanReview findFirst
   */
  export type PlanReviewFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PlanReview
     */
    select?: PlanReviewSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PlanReviewInclude<ExtArgs> | null
    /**
     * Filter, which PlanReview to fetch.
     */
    where?: PlanReviewWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PlanReviews to fetch.
     */
    orderBy?: PlanReviewOrderByWithRelationInput | PlanReviewOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for PlanReviews.
     */
    cursor?: PlanReviewWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PlanReviews from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PlanReviews.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of PlanReviews.
     */
    distinct?: PlanReviewScalarFieldEnum | PlanReviewScalarFieldEnum[]
  }

  /**
   * PlanReview findFirstOrThrow
   */
  export type PlanReviewFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PlanReview
     */
    select?: PlanReviewSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PlanReviewInclude<ExtArgs> | null
    /**
     * Filter, which PlanReview to fetch.
     */
    where?: PlanReviewWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PlanReviews to fetch.
     */
    orderBy?: PlanReviewOrderByWithRelationInput | PlanReviewOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for PlanReviews.
     */
    cursor?: PlanReviewWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PlanReviews from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PlanReviews.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of PlanReviews.
     */
    distinct?: PlanReviewScalarFieldEnum | PlanReviewScalarFieldEnum[]
  }

  /**
   * PlanReview findMany
   */
  export type PlanReviewFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PlanReview
     */
    select?: PlanReviewSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PlanReviewInclude<ExtArgs> | null
    /**
     * Filter, which PlanReviews to fetch.
     */
    where?: PlanReviewWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PlanReviews to fetch.
     */
    orderBy?: PlanReviewOrderByWithRelationInput | PlanReviewOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing PlanReviews.
     */
    cursor?: PlanReviewWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PlanReviews from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PlanReviews.
     */
    skip?: number
    distinct?: PlanReviewScalarFieldEnum | PlanReviewScalarFieldEnum[]
  }

  /**
   * PlanReview create
   */
  export type PlanReviewCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PlanReview
     */
    select?: PlanReviewSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PlanReviewInclude<ExtArgs> | null
    /**
     * The data needed to create a PlanReview.
     */
    data: XOR<PlanReviewCreateInput, PlanReviewUncheckedCreateInput>
  }

  /**
   * PlanReview createMany
   */
  export type PlanReviewCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many PlanReviews.
     */
    data: PlanReviewCreateManyInput | PlanReviewCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * PlanReview createManyAndReturn
   */
  export type PlanReviewCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PlanReview
     */
    select?: PlanReviewSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many PlanReviews.
     */
    data: PlanReviewCreateManyInput | PlanReviewCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PlanReviewIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * PlanReview update
   */
  export type PlanReviewUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PlanReview
     */
    select?: PlanReviewSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PlanReviewInclude<ExtArgs> | null
    /**
     * The data needed to update a PlanReview.
     */
    data: XOR<PlanReviewUpdateInput, PlanReviewUncheckedUpdateInput>
    /**
     * Choose, which PlanReview to update.
     */
    where: PlanReviewWhereUniqueInput
  }

  /**
   * PlanReview updateMany
   */
  export type PlanReviewUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update PlanReviews.
     */
    data: XOR<PlanReviewUpdateManyMutationInput, PlanReviewUncheckedUpdateManyInput>
    /**
     * Filter which PlanReviews to update
     */
    where?: PlanReviewWhereInput
  }

  /**
   * PlanReview upsert
   */
  export type PlanReviewUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PlanReview
     */
    select?: PlanReviewSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PlanReviewInclude<ExtArgs> | null
    /**
     * The filter to search for the PlanReview to update in case it exists.
     */
    where: PlanReviewWhereUniqueInput
    /**
     * In case the PlanReview found by the `where` argument doesn't exist, create a new PlanReview with this data.
     */
    create: XOR<PlanReviewCreateInput, PlanReviewUncheckedCreateInput>
    /**
     * In case the PlanReview was found with the provided `where` argument, update it with this data.
     */
    update: XOR<PlanReviewUpdateInput, PlanReviewUncheckedUpdateInput>
  }

  /**
   * PlanReview delete
   */
  export type PlanReviewDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PlanReview
     */
    select?: PlanReviewSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PlanReviewInclude<ExtArgs> | null
    /**
     * Filter which PlanReview to delete.
     */
    where: PlanReviewWhereUniqueInput
  }

  /**
   * PlanReview deleteMany
   */
  export type PlanReviewDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which PlanReviews to delete
     */
    where?: PlanReviewWhereInput
  }

  /**
   * PlanReview without action
   */
  export type PlanReviewDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PlanReview
     */
    select?: PlanReviewSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PlanReviewInclude<ExtArgs> | null
  }


  /**
   * Model TrainingPackage
   */

  export type AggregateTrainingPackage = {
    _count: TrainingPackageCountAggregateOutputType | null
    _avg: TrainingPackageAvgAggregateOutputType | null
    _sum: TrainingPackageSumAggregateOutputType | null
    _min: TrainingPackageMinAggregateOutputType | null
    _max: TrainingPackageMaxAggregateOutputType | null
  }

  export type TrainingPackageAvgAggregateOutputType = {
    price: number | null
    durationWeeks: number | null
  }

  export type TrainingPackageSumAggregateOutputType = {
    price: number | null
    durationWeeks: number | null
  }

  export type TrainingPackageMinAggregateOutputType = {
    id: string | null
    sellerId: string | null
    publishedPlanId: string | null
    name: string | null
    description: string | null
    price: number | null
    durationWeeks: number | null
    status: $Enums.TrainingPackageStatus | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type TrainingPackageMaxAggregateOutputType = {
    id: string | null
    sellerId: string | null
    publishedPlanId: string | null
    name: string | null
    description: string | null
    price: number | null
    durationWeeks: number | null
    status: $Enums.TrainingPackageStatus | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type TrainingPackageCountAggregateOutputType = {
    id: number
    sellerId: number
    publishedPlanId: number
    name: number
    description: number
    price: number
    durationWeeks: number
    status: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type TrainingPackageAvgAggregateInputType = {
    price?: true
    durationWeeks?: true
  }

  export type TrainingPackageSumAggregateInputType = {
    price?: true
    durationWeeks?: true
  }

  export type TrainingPackageMinAggregateInputType = {
    id?: true
    sellerId?: true
    publishedPlanId?: true
    name?: true
    description?: true
    price?: true
    durationWeeks?: true
    status?: true
    createdAt?: true
    updatedAt?: true
  }

  export type TrainingPackageMaxAggregateInputType = {
    id?: true
    sellerId?: true
    publishedPlanId?: true
    name?: true
    description?: true
    price?: true
    durationWeeks?: true
    status?: true
    createdAt?: true
    updatedAt?: true
  }

  export type TrainingPackageCountAggregateInputType = {
    id?: true
    sellerId?: true
    publishedPlanId?: true
    name?: true
    description?: true
    price?: true
    durationWeeks?: true
    status?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type TrainingPackageAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which TrainingPackage to aggregate.
     */
    where?: TrainingPackageWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of TrainingPackages to fetch.
     */
    orderBy?: TrainingPackageOrderByWithRelationInput | TrainingPackageOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: TrainingPackageWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` TrainingPackages from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` TrainingPackages.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned TrainingPackages
    **/
    _count?: true | TrainingPackageCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: TrainingPackageAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: TrainingPackageSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: TrainingPackageMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: TrainingPackageMaxAggregateInputType
  }

  export type GetTrainingPackageAggregateType<T extends TrainingPackageAggregateArgs> = {
        [P in keyof T & keyof AggregateTrainingPackage]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateTrainingPackage[P]>
      : GetScalarType<T[P], AggregateTrainingPackage[P]>
  }




  export type TrainingPackageGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: TrainingPackageWhereInput
    orderBy?: TrainingPackageOrderByWithAggregationInput | TrainingPackageOrderByWithAggregationInput[]
    by: TrainingPackageScalarFieldEnum[] | TrainingPackageScalarFieldEnum
    having?: TrainingPackageScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: TrainingPackageCountAggregateInputType | true
    _avg?: TrainingPackageAvgAggregateInputType
    _sum?: TrainingPackageSumAggregateInputType
    _min?: TrainingPackageMinAggregateInputType
    _max?: TrainingPackageMaxAggregateInputType
  }

  export type TrainingPackageGroupByOutputType = {
    id: string
    sellerId: string
    publishedPlanId: string
    name: string
    description: string | null
    price: number
    durationWeeks: number | null
    status: $Enums.TrainingPackageStatus
    createdAt: Date
    updatedAt: Date
    _count: TrainingPackageCountAggregateOutputType | null
    _avg: TrainingPackageAvgAggregateOutputType | null
    _sum: TrainingPackageSumAggregateOutputType | null
    _min: TrainingPackageMinAggregateOutputType | null
    _max: TrainingPackageMaxAggregateOutputType | null
  }

  type GetTrainingPackageGroupByPayload<T extends TrainingPackageGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<TrainingPackageGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof TrainingPackageGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], TrainingPackageGroupByOutputType[P]>
            : GetScalarType<T[P], TrainingPackageGroupByOutputType[P]>
        }
      >
    >


  export type TrainingPackageSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    sellerId?: boolean
    publishedPlanId?: boolean
    name?: boolean
    description?: boolean
    price?: boolean
    durationWeeks?: boolean
    status?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    publishedPlan?: boolean | PublishedPlanDefaultArgs<ExtArgs>
    purchases?: boolean | TrainingPackage$purchasesArgs<ExtArgs>
    _count?: boolean | TrainingPackageCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["trainingPackage"]>

  export type TrainingPackageSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    sellerId?: boolean
    publishedPlanId?: boolean
    name?: boolean
    description?: boolean
    price?: boolean
    durationWeeks?: boolean
    status?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    publishedPlan?: boolean | PublishedPlanDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["trainingPackage"]>

  export type TrainingPackageSelectScalar = {
    id?: boolean
    sellerId?: boolean
    publishedPlanId?: boolean
    name?: boolean
    description?: boolean
    price?: boolean
    durationWeeks?: boolean
    status?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type TrainingPackageInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    publishedPlan?: boolean | PublishedPlanDefaultArgs<ExtArgs>
    purchases?: boolean | TrainingPackage$purchasesArgs<ExtArgs>
    _count?: boolean | TrainingPackageCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type TrainingPackageIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    publishedPlan?: boolean | PublishedPlanDefaultArgs<ExtArgs>
  }

  export type $TrainingPackagePayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "TrainingPackage"
    objects: {
      publishedPlan: Prisma.$PublishedPlanPayload<ExtArgs>
      purchases: Prisma.$TrainingPackagePurchasePayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      sellerId: string
      publishedPlanId: string
      name: string
      description: string | null
      price: number
      durationWeeks: number | null
      status: $Enums.TrainingPackageStatus
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["trainingPackage"]>
    composites: {}
  }

  type TrainingPackageGetPayload<S extends boolean | null | undefined | TrainingPackageDefaultArgs> = $Result.GetResult<Prisma.$TrainingPackagePayload, S>

  type TrainingPackageCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<TrainingPackageFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: TrainingPackageCountAggregateInputType | true
    }

  export interface TrainingPackageDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['TrainingPackage'], meta: { name: 'TrainingPackage' } }
    /**
     * Find zero or one TrainingPackage that matches the filter.
     * @param {TrainingPackageFindUniqueArgs} args - Arguments to find a TrainingPackage
     * @example
     * // Get one TrainingPackage
     * const trainingPackage = await prisma.trainingPackage.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends TrainingPackageFindUniqueArgs>(args: SelectSubset<T, TrainingPackageFindUniqueArgs<ExtArgs>>): Prisma__TrainingPackageClient<$Result.GetResult<Prisma.$TrainingPackagePayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one TrainingPackage that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {TrainingPackageFindUniqueOrThrowArgs} args - Arguments to find a TrainingPackage
     * @example
     * // Get one TrainingPackage
     * const trainingPackage = await prisma.trainingPackage.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends TrainingPackageFindUniqueOrThrowArgs>(args: SelectSubset<T, TrainingPackageFindUniqueOrThrowArgs<ExtArgs>>): Prisma__TrainingPackageClient<$Result.GetResult<Prisma.$TrainingPackagePayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first TrainingPackage that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TrainingPackageFindFirstArgs} args - Arguments to find a TrainingPackage
     * @example
     * // Get one TrainingPackage
     * const trainingPackage = await prisma.trainingPackage.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends TrainingPackageFindFirstArgs>(args?: SelectSubset<T, TrainingPackageFindFirstArgs<ExtArgs>>): Prisma__TrainingPackageClient<$Result.GetResult<Prisma.$TrainingPackagePayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first TrainingPackage that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TrainingPackageFindFirstOrThrowArgs} args - Arguments to find a TrainingPackage
     * @example
     * // Get one TrainingPackage
     * const trainingPackage = await prisma.trainingPackage.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends TrainingPackageFindFirstOrThrowArgs>(args?: SelectSubset<T, TrainingPackageFindFirstOrThrowArgs<ExtArgs>>): Prisma__TrainingPackageClient<$Result.GetResult<Prisma.$TrainingPackagePayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more TrainingPackages that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TrainingPackageFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all TrainingPackages
     * const trainingPackages = await prisma.trainingPackage.findMany()
     * 
     * // Get first 10 TrainingPackages
     * const trainingPackages = await prisma.trainingPackage.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const trainingPackageWithIdOnly = await prisma.trainingPackage.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends TrainingPackageFindManyArgs>(args?: SelectSubset<T, TrainingPackageFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$TrainingPackagePayload<ExtArgs>, T, "findMany">>

    /**
     * Create a TrainingPackage.
     * @param {TrainingPackageCreateArgs} args - Arguments to create a TrainingPackage.
     * @example
     * // Create one TrainingPackage
     * const TrainingPackage = await prisma.trainingPackage.create({
     *   data: {
     *     // ... data to create a TrainingPackage
     *   }
     * })
     * 
     */
    create<T extends TrainingPackageCreateArgs>(args: SelectSubset<T, TrainingPackageCreateArgs<ExtArgs>>): Prisma__TrainingPackageClient<$Result.GetResult<Prisma.$TrainingPackagePayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many TrainingPackages.
     * @param {TrainingPackageCreateManyArgs} args - Arguments to create many TrainingPackages.
     * @example
     * // Create many TrainingPackages
     * const trainingPackage = await prisma.trainingPackage.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends TrainingPackageCreateManyArgs>(args?: SelectSubset<T, TrainingPackageCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many TrainingPackages and returns the data saved in the database.
     * @param {TrainingPackageCreateManyAndReturnArgs} args - Arguments to create many TrainingPackages.
     * @example
     * // Create many TrainingPackages
     * const trainingPackage = await prisma.trainingPackage.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many TrainingPackages and only return the `id`
     * const trainingPackageWithIdOnly = await prisma.trainingPackage.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends TrainingPackageCreateManyAndReturnArgs>(args?: SelectSubset<T, TrainingPackageCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$TrainingPackagePayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a TrainingPackage.
     * @param {TrainingPackageDeleteArgs} args - Arguments to delete one TrainingPackage.
     * @example
     * // Delete one TrainingPackage
     * const TrainingPackage = await prisma.trainingPackage.delete({
     *   where: {
     *     // ... filter to delete one TrainingPackage
     *   }
     * })
     * 
     */
    delete<T extends TrainingPackageDeleteArgs>(args: SelectSubset<T, TrainingPackageDeleteArgs<ExtArgs>>): Prisma__TrainingPackageClient<$Result.GetResult<Prisma.$TrainingPackagePayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one TrainingPackage.
     * @param {TrainingPackageUpdateArgs} args - Arguments to update one TrainingPackage.
     * @example
     * // Update one TrainingPackage
     * const trainingPackage = await prisma.trainingPackage.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends TrainingPackageUpdateArgs>(args: SelectSubset<T, TrainingPackageUpdateArgs<ExtArgs>>): Prisma__TrainingPackageClient<$Result.GetResult<Prisma.$TrainingPackagePayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more TrainingPackages.
     * @param {TrainingPackageDeleteManyArgs} args - Arguments to filter TrainingPackages to delete.
     * @example
     * // Delete a few TrainingPackages
     * const { count } = await prisma.trainingPackage.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends TrainingPackageDeleteManyArgs>(args?: SelectSubset<T, TrainingPackageDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more TrainingPackages.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TrainingPackageUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many TrainingPackages
     * const trainingPackage = await prisma.trainingPackage.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends TrainingPackageUpdateManyArgs>(args: SelectSubset<T, TrainingPackageUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one TrainingPackage.
     * @param {TrainingPackageUpsertArgs} args - Arguments to update or create a TrainingPackage.
     * @example
     * // Update or create a TrainingPackage
     * const trainingPackage = await prisma.trainingPackage.upsert({
     *   create: {
     *     // ... data to create a TrainingPackage
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the TrainingPackage we want to update
     *   }
     * })
     */
    upsert<T extends TrainingPackageUpsertArgs>(args: SelectSubset<T, TrainingPackageUpsertArgs<ExtArgs>>): Prisma__TrainingPackageClient<$Result.GetResult<Prisma.$TrainingPackagePayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of TrainingPackages.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TrainingPackageCountArgs} args - Arguments to filter TrainingPackages to count.
     * @example
     * // Count the number of TrainingPackages
     * const count = await prisma.trainingPackage.count({
     *   where: {
     *     // ... the filter for the TrainingPackages we want to count
     *   }
     * })
    **/
    count<T extends TrainingPackageCountArgs>(
      args?: Subset<T, TrainingPackageCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], TrainingPackageCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a TrainingPackage.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TrainingPackageAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends TrainingPackageAggregateArgs>(args: Subset<T, TrainingPackageAggregateArgs>): Prisma.PrismaPromise<GetTrainingPackageAggregateType<T>>

    /**
     * Group by TrainingPackage.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TrainingPackageGroupByArgs} args - Group by arguments.
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
      T extends TrainingPackageGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: TrainingPackageGroupByArgs['orderBy'] }
        : { orderBy?: TrainingPackageGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, TrainingPackageGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetTrainingPackageGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the TrainingPackage model
   */
  readonly fields: TrainingPackageFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for TrainingPackage.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__TrainingPackageClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    publishedPlan<T extends PublishedPlanDefaultArgs<ExtArgs> = {}>(args?: Subset<T, PublishedPlanDefaultArgs<ExtArgs>>): Prisma__PublishedPlanClient<$Result.GetResult<Prisma.$PublishedPlanPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
    purchases<T extends TrainingPackage$purchasesArgs<ExtArgs> = {}>(args?: Subset<T, TrainingPackage$purchasesArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$TrainingPackagePurchasePayload<ExtArgs>, T, "findMany"> | Null>
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
   * Fields of the TrainingPackage model
   */ 
  interface TrainingPackageFieldRefs {
    readonly id: FieldRef<"TrainingPackage", 'String'>
    readonly sellerId: FieldRef<"TrainingPackage", 'String'>
    readonly publishedPlanId: FieldRef<"TrainingPackage", 'String'>
    readonly name: FieldRef<"TrainingPackage", 'String'>
    readonly description: FieldRef<"TrainingPackage", 'String'>
    readonly price: FieldRef<"TrainingPackage", 'Float'>
    readonly durationWeeks: FieldRef<"TrainingPackage", 'Int'>
    readonly status: FieldRef<"TrainingPackage", 'TrainingPackageStatus'>
    readonly createdAt: FieldRef<"TrainingPackage", 'DateTime'>
    readonly updatedAt: FieldRef<"TrainingPackage", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * TrainingPackage findUnique
   */
  export type TrainingPackageFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TrainingPackage
     */
    select?: TrainingPackageSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TrainingPackageInclude<ExtArgs> | null
    /**
     * Filter, which TrainingPackage to fetch.
     */
    where: TrainingPackageWhereUniqueInput
  }

  /**
   * TrainingPackage findUniqueOrThrow
   */
  export type TrainingPackageFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TrainingPackage
     */
    select?: TrainingPackageSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TrainingPackageInclude<ExtArgs> | null
    /**
     * Filter, which TrainingPackage to fetch.
     */
    where: TrainingPackageWhereUniqueInput
  }

  /**
   * TrainingPackage findFirst
   */
  export type TrainingPackageFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TrainingPackage
     */
    select?: TrainingPackageSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TrainingPackageInclude<ExtArgs> | null
    /**
     * Filter, which TrainingPackage to fetch.
     */
    where?: TrainingPackageWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of TrainingPackages to fetch.
     */
    orderBy?: TrainingPackageOrderByWithRelationInput | TrainingPackageOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for TrainingPackages.
     */
    cursor?: TrainingPackageWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` TrainingPackages from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` TrainingPackages.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of TrainingPackages.
     */
    distinct?: TrainingPackageScalarFieldEnum | TrainingPackageScalarFieldEnum[]
  }

  /**
   * TrainingPackage findFirstOrThrow
   */
  export type TrainingPackageFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TrainingPackage
     */
    select?: TrainingPackageSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TrainingPackageInclude<ExtArgs> | null
    /**
     * Filter, which TrainingPackage to fetch.
     */
    where?: TrainingPackageWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of TrainingPackages to fetch.
     */
    orderBy?: TrainingPackageOrderByWithRelationInput | TrainingPackageOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for TrainingPackages.
     */
    cursor?: TrainingPackageWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` TrainingPackages from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` TrainingPackages.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of TrainingPackages.
     */
    distinct?: TrainingPackageScalarFieldEnum | TrainingPackageScalarFieldEnum[]
  }

  /**
   * TrainingPackage findMany
   */
  export type TrainingPackageFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TrainingPackage
     */
    select?: TrainingPackageSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TrainingPackageInclude<ExtArgs> | null
    /**
     * Filter, which TrainingPackages to fetch.
     */
    where?: TrainingPackageWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of TrainingPackages to fetch.
     */
    orderBy?: TrainingPackageOrderByWithRelationInput | TrainingPackageOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing TrainingPackages.
     */
    cursor?: TrainingPackageWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` TrainingPackages from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` TrainingPackages.
     */
    skip?: number
    distinct?: TrainingPackageScalarFieldEnum | TrainingPackageScalarFieldEnum[]
  }

  /**
   * TrainingPackage create
   */
  export type TrainingPackageCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TrainingPackage
     */
    select?: TrainingPackageSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TrainingPackageInclude<ExtArgs> | null
    /**
     * The data needed to create a TrainingPackage.
     */
    data: XOR<TrainingPackageCreateInput, TrainingPackageUncheckedCreateInput>
  }

  /**
   * TrainingPackage createMany
   */
  export type TrainingPackageCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many TrainingPackages.
     */
    data: TrainingPackageCreateManyInput | TrainingPackageCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * TrainingPackage createManyAndReturn
   */
  export type TrainingPackageCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TrainingPackage
     */
    select?: TrainingPackageSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many TrainingPackages.
     */
    data: TrainingPackageCreateManyInput | TrainingPackageCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TrainingPackageIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * TrainingPackage update
   */
  export type TrainingPackageUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TrainingPackage
     */
    select?: TrainingPackageSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TrainingPackageInclude<ExtArgs> | null
    /**
     * The data needed to update a TrainingPackage.
     */
    data: XOR<TrainingPackageUpdateInput, TrainingPackageUncheckedUpdateInput>
    /**
     * Choose, which TrainingPackage to update.
     */
    where: TrainingPackageWhereUniqueInput
  }

  /**
   * TrainingPackage updateMany
   */
  export type TrainingPackageUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update TrainingPackages.
     */
    data: XOR<TrainingPackageUpdateManyMutationInput, TrainingPackageUncheckedUpdateManyInput>
    /**
     * Filter which TrainingPackages to update
     */
    where?: TrainingPackageWhereInput
  }

  /**
   * TrainingPackage upsert
   */
  export type TrainingPackageUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TrainingPackage
     */
    select?: TrainingPackageSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TrainingPackageInclude<ExtArgs> | null
    /**
     * The filter to search for the TrainingPackage to update in case it exists.
     */
    where: TrainingPackageWhereUniqueInput
    /**
     * In case the TrainingPackage found by the `where` argument doesn't exist, create a new TrainingPackage with this data.
     */
    create: XOR<TrainingPackageCreateInput, TrainingPackageUncheckedCreateInput>
    /**
     * In case the TrainingPackage was found with the provided `where` argument, update it with this data.
     */
    update: XOR<TrainingPackageUpdateInput, TrainingPackageUncheckedUpdateInput>
  }

  /**
   * TrainingPackage delete
   */
  export type TrainingPackageDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TrainingPackage
     */
    select?: TrainingPackageSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TrainingPackageInclude<ExtArgs> | null
    /**
     * Filter which TrainingPackage to delete.
     */
    where: TrainingPackageWhereUniqueInput
  }

  /**
   * TrainingPackage deleteMany
   */
  export type TrainingPackageDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which TrainingPackages to delete
     */
    where?: TrainingPackageWhereInput
  }

  /**
   * TrainingPackage.purchases
   */
  export type TrainingPackage$purchasesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TrainingPackagePurchase
     */
    select?: TrainingPackagePurchaseSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TrainingPackagePurchaseInclude<ExtArgs> | null
    where?: TrainingPackagePurchaseWhereInput
    orderBy?: TrainingPackagePurchaseOrderByWithRelationInput | TrainingPackagePurchaseOrderByWithRelationInput[]
    cursor?: TrainingPackagePurchaseWhereUniqueInput
    take?: number
    skip?: number
    distinct?: TrainingPackagePurchaseScalarFieldEnum | TrainingPackagePurchaseScalarFieldEnum[]
  }

  /**
   * TrainingPackage without action
   */
  export type TrainingPackageDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TrainingPackage
     */
    select?: TrainingPackageSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TrainingPackageInclude<ExtArgs> | null
  }


  /**
   * Model TrainingPackagePurchase
   */

  export type AggregateTrainingPackagePurchase = {
    _count: TrainingPackagePurchaseCountAggregateOutputType | null
    _avg: TrainingPackagePurchaseAvgAggregateOutputType | null
    _sum: TrainingPackagePurchaseSumAggregateOutputType | null
    _min: TrainingPackagePurchaseMinAggregateOutputType | null
    _max: TrainingPackagePurchaseMaxAggregateOutputType | null
  }

  export type TrainingPackagePurchaseAvgAggregateOutputType = {
    priceAtPurchase: number | null
  }

  export type TrainingPackagePurchaseSumAggregateOutputType = {
    priceAtPurchase: number | null
  }

  export type TrainingPackagePurchaseMinAggregateOutputType = {
    id: string | null
    packageId: string | null
    buyerId: string | null
    priceAtPurchase: number | null
    paymentTransactionId: string | null
    status: $Enums.TrainingPackagePurchaseStatus | null
    purchasedAt: Date | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type TrainingPackagePurchaseMaxAggregateOutputType = {
    id: string | null
    packageId: string | null
    buyerId: string | null
    priceAtPurchase: number | null
    paymentTransactionId: string | null
    status: $Enums.TrainingPackagePurchaseStatus | null
    purchasedAt: Date | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type TrainingPackagePurchaseCountAggregateOutputType = {
    id: number
    packageId: number
    buyerId: number
    priceAtPurchase: number
    paymentTransactionId: number
    status: number
    purchasedAt: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type TrainingPackagePurchaseAvgAggregateInputType = {
    priceAtPurchase?: true
  }

  export type TrainingPackagePurchaseSumAggregateInputType = {
    priceAtPurchase?: true
  }

  export type TrainingPackagePurchaseMinAggregateInputType = {
    id?: true
    packageId?: true
    buyerId?: true
    priceAtPurchase?: true
    paymentTransactionId?: true
    status?: true
    purchasedAt?: true
    createdAt?: true
    updatedAt?: true
  }

  export type TrainingPackagePurchaseMaxAggregateInputType = {
    id?: true
    packageId?: true
    buyerId?: true
    priceAtPurchase?: true
    paymentTransactionId?: true
    status?: true
    purchasedAt?: true
    createdAt?: true
    updatedAt?: true
  }

  export type TrainingPackagePurchaseCountAggregateInputType = {
    id?: true
    packageId?: true
    buyerId?: true
    priceAtPurchase?: true
    paymentTransactionId?: true
    status?: true
    purchasedAt?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type TrainingPackagePurchaseAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which TrainingPackagePurchase to aggregate.
     */
    where?: TrainingPackagePurchaseWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of TrainingPackagePurchases to fetch.
     */
    orderBy?: TrainingPackagePurchaseOrderByWithRelationInput | TrainingPackagePurchaseOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: TrainingPackagePurchaseWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` TrainingPackagePurchases from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` TrainingPackagePurchases.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned TrainingPackagePurchases
    **/
    _count?: true | TrainingPackagePurchaseCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: TrainingPackagePurchaseAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: TrainingPackagePurchaseSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: TrainingPackagePurchaseMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: TrainingPackagePurchaseMaxAggregateInputType
  }

  export type GetTrainingPackagePurchaseAggregateType<T extends TrainingPackagePurchaseAggregateArgs> = {
        [P in keyof T & keyof AggregateTrainingPackagePurchase]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateTrainingPackagePurchase[P]>
      : GetScalarType<T[P], AggregateTrainingPackagePurchase[P]>
  }




  export type TrainingPackagePurchaseGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: TrainingPackagePurchaseWhereInput
    orderBy?: TrainingPackagePurchaseOrderByWithAggregationInput | TrainingPackagePurchaseOrderByWithAggregationInput[]
    by: TrainingPackagePurchaseScalarFieldEnum[] | TrainingPackagePurchaseScalarFieldEnum
    having?: TrainingPackagePurchaseScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: TrainingPackagePurchaseCountAggregateInputType | true
    _avg?: TrainingPackagePurchaseAvgAggregateInputType
    _sum?: TrainingPackagePurchaseSumAggregateInputType
    _min?: TrainingPackagePurchaseMinAggregateInputType
    _max?: TrainingPackagePurchaseMaxAggregateInputType
  }

  export type TrainingPackagePurchaseGroupByOutputType = {
    id: string
    packageId: string
    buyerId: string
    priceAtPurchase: number
    paymentTransactionId: string | null
    status: $Enums.TrainingPackagePurchaseStatus
    purchasedAt: Date | null
    createdAt: Date
    updatedAt: Date
    _count: TrainingPackagePurchaseCountAggregateOutputType | null
    _avg: TrainingPackagePurchaseAvgAggregateOutputType | null
    _sum: TrainingPackagePurchaseSumAggregateOutputType | null
    _min: TrainingPackagePurchaseMinAggregateOutputType | null
    _max: TrainingPackagePurchaseMaxAggregateOutputType | null
  }

  type GetTrainingPackagePurchaseGroupByPayload<T extends TrainingPackagePurchaseGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<TrainingPackagePurchaseGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof TrainingPackagePurchaseGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], TrainingPackagePurchaseGroupByOutputType[P]>
            : GetScalarType<T[P], TrainingPackagePurchaseGroupByOutputType[P]>
        }
      >
    >


  export type TrainingPackagePurchaseSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    packageId?: boolean
    buyerId?: boolean
    priceAtPurchase?: boolean
    paymentTransactionId?: boolean
    status?: boolean
    purchasedAt?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    package?: boolean | TrainingPackageDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["trainingPackagePurchase"]>

  export type TrainingPackagePurchaseSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    packageId?: boolean
    buyerId?: boolean
    priceAtPurchase?: boolean
    paymentTransactionId?: boolean
    status?: boolean
    purchasedAt?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    package?: boolean | TrainingPackageDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["trainingPackagePurchase"]>

  export type TrainingPackagePurchaseSelectScalar = {
    id?: boolean
    packageId?: boolean
    buyerId?: boolean
    priceAtPurchase?: boolean
    paymentTransactionId?: boolean
    status?: boolean
    purchasedAt?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type TrainingPackagePurchaseInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    package?: boolean | TrainingPackageDefaultArgs<ExtArgs>
  }
  export type TrainingPackagePurchaseIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    package?: boolean | TrainingPackageDefaultArgs<ExtArgs>
  }

  export type $TrainingPackagePurchasePayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "TrainingPackagePurchase"
    objects: {
      package: Prisma.$TrainingPackagePayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      packageId: string
      buyerId: string
      priceAtPurchase: number
      paymentTransactionId: string | null
      status: $Enums.TrainingPackagePurchaseStatus
      purchasedAt: Date | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["trainingPackagePurchase"]>
    composites: {}
  }

  type TrainingPackagePurchaseGetPayload<S extends boolean | null | undefined | TrainingPackagePurchaseDefaultArgs> = $Result.GetResult<Prisma.$TrainingPackagePurchasePayload, S>

  type TrainingPackagePurchaseCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<TrainingPackagePurchaseFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: TrainingPackagePurchaseCountAggregateInputType | true
    }

  export interface TrainingPackagePurchaseDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['TrainingPackagePurchase'], meta: { name: 'TrainingPackagePurchase' } }
    /**
     * Find zero or one TrainingPackagePurchase that matches the filter.
     * @param {TrainingPackagePurchaseFindUniqueArgs} args - Arguments to find a TrainingPackagePurchase
     * @example
     * // Get one TrainingPackagePurchase
     * const trainingPackagePurchase = await prisma.trainingPackagePurchase.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends TrainingPackagePurchaseFindUniqueArgs>(args: SelectSubset<T, TrainingPackagePurchaseFindUniqueArgs<ExtArgs>>): Prisma__TrainingPackagePurchaseClient<$Result.GetResult<Prisma.$TrainingPackagePurchasePayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one TrainingPackagePurchase that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {TrainingPackagePurchaseFindUniqueOrThrowArgs} args - Arguments to find a TrainingPackagePurchase
     * @example
     * // Get one TrainingPackagePurchase
     * const trainingPackagePurchase = await prisma.trainingPackagePurchase.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends TrainingPackagePurchaseFindUniqueOrThrowArgs>(args: SelectSubset<T, TrainingPackagePurchaseFindUniqueOrThrowArgs<ExtArgs>>): Prisma__TrainingPackagePurchaseClient<$Result.GetResult<Prisma.$TrainingPackagePurchasePayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first TrainingPackagePurchase that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TrainingPackagePurchaseFindFirstArgs} args - Arguments to find a TrainingPackagePurchase
     * @example
     * // Get one TrainingPackagePurchase
     * const trainingPackagePurchase = await prisma.trainingPackagePurchase.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends TrainingPackagePurchaseFindFirstArgs>(args?: SelectSubset<T, TrainingPackagePurchaseFindFirstArgs<ExtArgs>>): Prisma__TrainingPackagePurchaseClient<$Result.GetResult<Prisma.$TrainingPackagePurchasePayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first TrainingPackagePurchase that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TrainingPackagePurchaseFindFirstOrThrowArgs} args - Arguments to find a TrainingPackagePurchase
     * @example
     * // Get one TrainingPackagePurchase
     * const trainingPackagePurchase = await prisma.trainingPackagePurchase.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends TrainingPackagePurchaseFindFirstOrThrowArgs>(args?: SelectSubset<T, TrainingPackagePurchaseFindFirstOrThrowArgs<ExtArgs>>): Prisma__TrainingPackagePurchaseClient<$Result.GetResult<Prisma.$TrainingPackagePurchasePayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more TrainingPackagePurchases that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TrainingPackagePurchaseFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all TrainingPackagePurchases
     * const trainingPackagePurchases = await prisma.trainingPackagePurchase.findMany()
     * 
     * // Get first 10 TrainingPackagePurchases
     * const trainingPackagePurchases = await prisma.trainingPackagePurchase.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const trainingPackagePurchaseWithIdOnly = await prisma.trainingPackagePurchase.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends TrainingPackagePurchaseFindManyArgs>(args?: SelectSubset<T, TrainingPackagePurchaseFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$TrainingPackagePurchasePayload<ExtArgs>, T, "findMany">>

    /**
     * Create a TrainingPackagePurchase.
     * @param {TrainingPackagePurchaseCreateArgs} args - Arguments to create a TrainingPackagePurchase.
     * @example
     * // Create one TrainingPackagePurchase
     * const TrainingPackagePurchase = await prisma.trainingPackagePurchase.create({
     *   data: {
     *     // ... data to create a TrainingPackagePurchase
     *   }
     * })
     * 
     */
    create<T extends TrainingPackagePurchaseCreateArgs>(args: SelectSubset<T, TrainingPackagePurchaseCreateArgs<ExtArgs>>): Prisma__TrainingPackagePurchaseClient<$Result.GetResult<Prisma.$TrainingPackagePurchasePayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many TrainingPackagePurchases.
     * @param {TrainingPackagePurchaseCreateManyArgs} args - Arguments to create many TrainingPackagePurchases.
     * @example
     * // Create many TrainingPackagePurchases
     * const trainingPackagePurchase = await prisma.trainingPackagePurchase.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends TrainingPackagePurchaseCreateManyArgs>(args?: SelectSubset<T, TrainingPackagePurchaseCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many TrainingPackagePurchases and returns the data saved in the database.
     * @param {TrainingPackagePurchaseCreateManyAndReturnArgs} args - Arguments to create many TrainingPackagePurchases.
     * @example
     * // Create many TrainingPackagePurchases
     * const trainingPackagePurchase = await prisma.trainingPackagePurchase.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many TrainingPackagePurchases and only return the `id`
     * const trainingPackagePurchaseWithIdOnly = await prisma.trainingPackagePurchase.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends TrainingPackagePurchaseCreateManyAndReturnArgs>(args?: SelectSubset<T, TrainingPackagePurchaseCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$TrainingPackagePurchasePayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a TrainingPackagePurchase.
     * @param {TrainingPackagePurchaseDeleteArgs} args - Arguments to delete one TrainingPackagePurchase.
     * @example
     * // Delete one TrainingPackagePurchase
     * const TrainingPackagePurchase = await prisma.trainingPackagePurchase.delete({
     *   where: {
     *     // ... filter to delete one TrainingPackagePurchase
     *   }
     * })
     * 
     */
    delete<T extends TrainingPackagePurchaseDeleteArgs>(args: SelectSubset<T, TrainingPackagePurchaseDeleteArgs<ExtArgs>>): Prisma__TrainingPackagePurchaseClient<$Result.GetResult<Prisma.$TrainingPackagePurchasePayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one TrainingPackagePurchase.
     * @param {TrainingPackagePurchaseUpdateArgs} args - Arguments to update one TrainingPackagePurchase.
     * @example
     * // Update one TrainingPackagePurchase
     * const trainingPackagePurchase = await prisma.trainingPackagePurchase.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends TrainingPackagePurchaseUpdateArgs>(args: SelectSubset<T, TrainingPackagePurchaseUpdateArgs<ExtArgs>>): Prisma__TrainingPackagePurchaseClient<$Result.GetResult<Prisma.$TrainingPackagePurchasePayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more TrainingPackagePurchases.
     * @param {TrainingPackagePurchaseDeleteManyArgs} args - Arguments to filter TrainingPackagePurchases to delete.
     * @example
     * // Delete a few TrainingPackagePurchases
     * const { count } = await prisma.trainingPackagePurchase.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends TrainingPackagePurchaseDeleteManyArgs>(args?: SelectSubset<T, TrainingPackagePurchaseDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more TrainingPackagePurchases.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TrainingPackagePurchaseUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many TrainingPackagePurchases
     * const trainingPackagePurchase = await prisma.trainingPackagePurchase.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends TrainingPackagePurchaseUpdateManyArgs>(args: SelectSubset<T, TrainingPackagePurchaseUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one TrainingPackagePurchase.
     * @param {TrainingPackagePurchaseUpsertArgs} args - Arguments to update or create a TrainingPackagePurchase.
     * @example
     * // Update or create a TrainingPackagePurchase
     * const trainingPackagePurchase = await prisma.trainingPackagePurchase.upsert({
     *   create: {
     *     // ... data to create a TrainingPackagePurchase
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the TrainingPackagePurchase we want to update
     *   }
     * })
     */
    upsert<T extends TrainingPackagePurchaseUpsertArgs>(args: SelectSubset<T, TrainingPackagePurchaseUpsertArgs<ExtArgs>>): Prisma__TrainingPackagePurchaseClient<$Result.GetResult<Prisma.$TrainingPackagePurchasePayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of TrainingPackagePurchases.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TrainingPackagePurchaseCountArgs} args - Arguments to filter TrainingPackagePurchases to count.
     * @example
     * // Count the number of TrainingPackagePurchases
     * const count = await prisma.trainingPackagePurchase.count({
     *   where: {
     *     // ... the filter for the TrainingPackagePurchases we want to count
     *   }
     * })
    **/
    count<T extends TrainingPackagePurchaseCountArgs>(
      args?: Subset<T, TrainingPackagePurchaseCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], TrainingPackagePurchaseCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a TrainingPackagePurchase.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TrainingPackagePurchaseAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends TrainingPackagePurchaseAggregateArgs>(args: Subset<T, TrainingPackagePurchaseAggregateArgs>): Prisma.PrismaPromise<GetTrainingPackagePurchaseAggregateType<T>>

    /**
     * Group by TrainingPackagePurchase.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TrainingPackagePurchaseGroupByArgs} args - Group by arguments.
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
      T extends TrainingPackagePurchaseGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: TrainingPackagePurchaseGroupByArgs['orderBy'] }
        : { orderBy?: TrainingPackagePurchaseGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, TrainingPackagePurchaseGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetTrainingPackagePurchaseGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the TrainingPackagePurchase model
   */
  readonly fields: TrainingPackagePurchaseFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for TrainingPackagePurchase.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__TrainingPackagePurchaseClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    package<T extends TrainingPackageDefaultArgs<ExtArgs> = {}>(args?: Subset<T, TrainingPackageDefaultArgs<ExtArgs>>): Prisma__TrainingPackageClient<$Result.GetResult<Prisma.$TrainingPackagePayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
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
   * Fields of the TrainingPackagePurchase model
   */ 
  interface TrainingPackagePurchaseFieldRefs {
    readonly id: FieldRef<"TrainingPackagePurchase", 'String'>
    readonly packageId: FieldRef<"TrainingPackagePurchase", 'String'>
    readonly buyerId: FieldRef<"TrainingPackagePurchase", 'String'>
    readonly priceAtPurchase: FieldRef<"TrainingPackagePurchase", 'Float'>
    readonly paymentTransactionId: FieldRef<"TrainingPackagePurchase", 'String'>
    readonly status: FieldRef<"TrainingPackagePurchase", 'TrainingPackagePurchaseStatus'>
    readonly purchasedAt: FieldRef<"TrainingPackagePurchase", 'DateTime'>
    readonly createdAt: FieldRef<"TrainingPackagePurchase", 'DateTime'>
    readonly updatedAt: FieldRef<"TrainingPackagePurchase", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * TrainingPackagePurchase findUnique
   */
  export type TrainingPackagePurchaseFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TrainingPackagePurchase
     */
    select?: TrainingPackagePurchaseSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TrainingPackagePurchaseInclude<ExtArgs> | null
    /**
     * Filter, which TrainingPackagePurchase to fetch.
     */
    where: TrainingPackagePurchaseWhereUniqueInput
  }

  /**
   * TrainingPackagePurchase findUniqueOrThrow
   */
  export type TrainingPackagePurchaseFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TrainingPackagePurchase
     */
    select?: TrainingPackagePurchaseSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TrainingPackagePurchaseInclude<ExtArgs> | null
    /**
     * Filter, which TrainingPackagePurchase to fetch.
     */
    where: TrainingPackagePurchaseWhereUniqueInput
  }

  /**
   * TrainingPackagePurchase findFirst
   */
  export type TrainingPackagePurchaseFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TrainingPackagePurchase
     */
    select?: TrainingPackagePurchaseSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TrainingPackagePurchaseInclude<ExtArgs> | null
    /**
     * Filter, which TrainingPackagePurchase to fetch.
     */
    where?: TrainingPackagePurchaseWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of TrainingPackagePurchases to fetch.
     */
    orderBy?: TrainingPackagePurchaseOrderByWithRelationInput | TrainingPackagePurchaseOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for TrainingPackagePurchases.
     */
    cursor?: TrainingPackagePurchaseWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` TrainingPackagePurchases from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` TrainingPackagePurchases.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of TrainingPackagePurchases.
     */
    distinct?: TrainingPackagePurchaseScalarFieldEnum | TrainingPackagePurchaseScalarFieldEnum[]
  }

  /**
   * TrainingPackagePurchase findFirstOrThrow
   */
  export type TrainingPackagePurchaseFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TrainingPackagePurchase
     */
    select?: TrainingPackagePurchaseSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TrainingPackagePurchaseInclude<ExtArgs> | null
    /**
     * Filter, which TrainingPackagePurchase to fetch.
     */
    where?: TrainingPackagePurchaseWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of TrainingPackagePurchases to fetch.
     */
    orderBy?: TrainingPackagePurchaseOrderByWithRelationInput | TrainingPackagePurchaseOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for TrainingPackagePurchases.
     */
    cursor?: TrainingPackagePurchaseWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` TrainingPackagePurchases from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` TrainingPackagePurchases.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of TrainingPackagePurchases.
     */
    distinct?: TrainingPackagePurchaseScalarFieldEnum | TrainingPackagePurchaseScalarFieldEnum[]
  }

  /**
   * TrainingPackagePurchase findMany
   */
  export type TrainingPackagePurchaseFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TrainingPackagePurchase
     */
    select?: TrainingPackagePurchaseSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TrainingPackagePurchaseInclude<ExtArgs> | null
    /**
     * Filter, which TrainingPackagePurchases to fetch.
     */
    where?: TrainingPackagePurchaseWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of TrainingPackagePurchases to fetch.
     */
    orderBy?: TrainingPackagePurchaseOrderByWithRelationInput | TrainingPackagePurchaseOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing TrainingPackagePurchases.
     */
    cursor?: TrainingPackagePurchaseWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` TrainingPackagePurchases from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` TrainingPackagePurchases.
     */
    skip?: number
    distinct?: TrainingPackagePurchaseScalarFieldEnum | TrainingPackagePurchaseScalarFieldEnum[]
  }

  /**
   * TrainingPackagePurchase create
   */
  export type TrainingPackagePurchaseCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TrainingPackagePurchase
     */
    select?: TrainingPackagePurchaseSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TrainingPackagePurchaseInclude<ExtArgs> | null
    /**
     * The data needed to create a TrainingPackagePurchase.
     */
    data: XOR<TrainingPackagePurchaseCreateInput, TrainingPackagePurchaseUncheckedCreateInput>
  }

  /**
   * TrainingPackagePurchase createMany
   */
  export type TrainingPackagePurchaseCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many TrainingPackagePurchases.
     */
    data: TrainingPackagePurchaseCreateManyInput | TrainingPackagePurchaseCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * TrainingPackagePurchase createManyAndReturn
   */
  export type TrainingPackagePurchaseCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TrainingPackagePurchase
     */
    select?: TrainingPackagePurchaseSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many TrainingPackagePurchases.
     */
    data: TrainingPackagePurchaseCreateManyInput | TrainingPackagePurchaseCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TrainingPackagePurchaseIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * TrainingPackagePurchase update
   */
  export type TrainingPackagePurchaseUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TrainingPackagePurchase
     */
    select?: TrainingPackagePurchaseSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TrainingPackagePurchaseInclude<ExtArgs> | null
    /**
     * The data needed to update a TrainingPackagePurchase.
     */
    data: XOR<TrainingPackagePurchaseUpdateInput, TrainingPackagePurchaseUncheckedUpdateInput>
    /**
     * Choose, which TrainingPackagePurchase to update.
     */
    where: TrainingPackagePurchaseWhereUniqueInput
  }

  /**
   * TrainingPackagePurchase updateMany
   */
  export type TrainingPackagePurchaseUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update TrainingPackagePurchases.
     */
    data: XOR<TrainingPackagePurchaseUpdateManyMutationInput, TrainingPackagePurchaseUncheckedUpdateManyInput>
    /**
     * Filter which TrainingPackagePurchases to update
     */
    where?: TrainingPackagePurchaseWhereInput
  }

  /**
   * TrainingPackagePurchase upsert
   */
  export type TrainingPackagePurchaseUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TrainingPackagePurchase
     */
    select?: TrainingPackagePurchaseSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TrainingPackagePurchaseInclude<ExtArgs> | null
    /**
     * The filter to search for the TrainingPackagePurchase to update in case it exists.
     */
    where: TrainingPackagePurchaseWhereUniqueInput
    /**
     * In case the TrainingPackagePurchase found by the `where` argument doesn't exist, create a new TrainingPackagePurchase with this data.
     */
    create: XOR<TrainingPackagePurchaseCreateInput, TrainingPackagePurchaseUncheckedCreateInput>
    /**
     * In case the TrainingPackagePurchase was found with the provided `where` argument, update it with this data.
     */
    update: XOR<TrainingPackagePurchaseUpdateInput, TrainingPackagePurchaseUncheckedUpdateInput>
  }

  /**
   * TrainingPackagePurchase delete
   */
  export type TrainingPackagePurchaseDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TrainingPackagePurchase
     */
    select?: TrainingPackagePurchaseSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TrainingPackagePurchaseInclude<ExtArgs> | null
    /**
     * Filter which TrainingPackagePurchase to delete.
     */
    where: TrainingPackagePurchaseWhereUniqueInput
  }

  /**
   * TrainingPackagePurchase deleteMany
   */
  export type TrainingPackagePurchaseDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which TrainingPackagePurchases to delete
     */
    where?: TrainingPackagePurchaseWhereInput
  }

  /**
   * TrainingPackagePurchase without action
   */
  export type TrainingPackagePurchaseDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TrainingPackagePurchase
     */
    select?: TrainingPackagePurchaseSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TrainingPackagePurchaseInclude<ExtArgs> | null
  }


  /**
   * Model NutritionPlan
   */

  export type AggregateNutritionPlan = {
    _count: NutritionPlanCountAggregateOutputType | null
    _avg: NutritionPlanAvgAggregateOutputType | null
    _sum: NutritionPlanSumAggregateOutputType | null
    _min: NutritionPlanMinAggregateOutputType | null
    _max: NutritionPlanMaxAggregateOutputType | null
  }

  export type NutritionPlanAvgAggregateOutputType = {
    durationWeeks: number | null
    mealsPerDay: number | null
  }

  export type NutritionPlanSumAggregateOutputType = {
    durationWeeks: number | null
    mealsPerDay: number | null
  }

  export type NutritionPlanMinAggregateOutputType = {
    id: string | null
    userId: string | null
    name: string | null
    goal: string | null
    durationWeeks: number | null
    mealsPerDay: number | null
    status: $Enums.PlanStatus | null
    jobId: string | null
    failReason: string | null
    archivedAt: Date | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type NutritionPlanMaxAggregateOutputType = {
    id: string | null
    userId: string | null
    name: string | null
    goal: string | null
    durationWeeks: number | null
    mealsPerDay: number | null
    status: $Enums.PlanStatus | null
    jobId: string | null
    failReason: string | null
    archivedAt: Date | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type NutritionPlanCountAggregateOutputType = {
    id: number
    userId: number
    name: number
    goal: number
    durationWeeks: number
    mealsPerDay: number
    plan: number
    status: number
    jobId: number
    failReason: number
    archivedAt: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type NutritionPlanAvgAggregateInputType = {
    durationWeeks?: true
    mealsPerDay?: true
  }

  export type NutritionPlanSumAggregateInputType = {
    durationWeeks?: true
    mealsPerDay?: true
  }

  export type NutritionPlanMinAggregateInputType = {
    id?: true
    userId?: true
    name?: true
    goal?: true
    durationWeeks?: true
    mealsPerDay?: true
    status?: true
    jobId?: true
    failReason?: true
    archivedAt?: true
    createdAt?: true
    updatedAt?: true
  }

  export type NutritionPlanMaxAggregateInputType = {
    id?: true
    userId?: true
    name?: true
    goal?: true
    durationWeeks?: true
    mealsPerDay?: true
    status?: true
    jobId?: true
    failReason?: true
    archivedAt?: true
    createdAt?: true
    updatedAt?: true
  }

  export type NutritionPlanCountAggregateInputType = {
    id?: true
    userId?: true
    name?: true
    goal?: true
    durationWeeks?: true
    mealsPerDay?: true
    plan?: true
    status?: true
    jobId?: true
    failReason?: true
    archivedAt?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type NutritionPlanAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which NutritionPlan to aggregate.
     */
    where?: NutritionPlanWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of NutritionPlans to fetch.
     */
    orderBy?: NutritionPlanOrderByWithRelationInput | NutritionPlanOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: NutritionPlanWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` NutritionPlans from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` NutritionPlans.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned NutritionPlans
    **/
    _count?: true | NutritionPlanCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: NutritionPlanAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: NutritionPlanSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: NutritionPlanMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: NutritionPlanMaxAggregateInputType
  }

  export type GetNutritionPlanAggregateType<T extends NutritionPlanAggregateArgs> = {
        [P in keyof T & keyof AggregateNutritionPlan]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateNutritionPlan[P]>
      : GetScalarType<T[P], AggregateNutritionPlan[P]>
  }




  export type NutritionPlanGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: NutritionPlanWhereInput
    orderBy?: NutritionPlanOrderByWithAggregationInput | NutritionPlanOrderByWithAggregationInput[]
    by: NutritionPlanScalarFieldEnum[] | NutritionPlanScalarFieldEnum
    having?: NutritionPlanScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: NutritionPlanCountAggregateInputType | true
    _avg?: NutritionPlanAvgAggregateInputType
    _sum?: NutritionPlanSumAggregateInputType
    _min?: NutritionPlanMinAggregateInputType
    _max?: NutritionPlanMaxAggregateInputType
  }

  export type NutritionPlanGroupByOutputType = {
    id: string
    userId: string
    name: string
    goal: string
    durationWeeks: number
    mealsPerDay: number
    plan: JsonValue
    status: $Enums.PlanStatus
    jobId: string | null
    failReason: string | null
    archivedAt: Date | null
    createdAt: Date
    updatedAt: Date
    _count: NutritionPlanCountAggregateOutputType | null
    _avg: NutritionPlanAvgAggregateOutputType | null
    _sum: NutritionPlanSumAggregateOutputType | null
    _min: NutritionPlanMinAggregateOutputType | null
    _max: NutritionPlanMaxAggregateOutputType | null
  }

  type GetNutritionPlanGroupByPayload<T extends NutritionPlanGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<NutritionPlanGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof NutritionPlanGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], NutritionPlanGroupByOutputType[P]>
            : GetScalarType<T[P], NutritionPlanGroupByOutputType[P]>
        }
      >
    >


  export type NutritionPlanSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    userId?: boolean
    name?: boolean
    goal?: boolean
    durationWeeks?: boolean
    mealsPerDay?: boolean
    plan?: boolean
    status?: boolean
    jobId?: boolean
    failReason?: boolean
    archivedAt?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["nutritionPlan"]>

  export type NutritionPlanSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    userId?: boolean
    name?: boolean
    goal?: boolean
    durationWeeks?: boolean
    mealsPerDay?: boolean
    plan?: boolean
    status?: boolean
    jobId?: boolean
    failReason?: boolean
    archivedAt?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["nutritionPlan"]>

  export type NutritionPlanSelectScalar = {
    id?: boolean
    userId?: boolean
    name?: boolean
    goal?: boolean
    durationWeeks?: boolean
    mealsPerDay?: boolean
    plan?: boolean
    status?: boolean
    jobId?: boolean
    failReason?: boolean
    archivedAt?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }


  export type $NutritionPlanPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "NutritionPlan"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: string
      userId: string
      name: string
      goal: string
      durationWeeks: number
      mealsPerDay: number
      /**
       * Structured JSON matching NutritionPlanContentSchema once COMPLETED; empty object while QUEUED/PROCESSING
       */
      plan: Prisma.JsonValue
      status: $Enums.PlanStatus
      jobId: string | null
      failReason: string | null
      archivedAt: Date | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["nutritionPlan"]>
    composites: {}
  }

  type NutritionPlanGetPayload<S extends boolean | null | undefined | NutritionPlanDefaultArgs> = $Result.GetResult<Prisma.$NutritionPlanPayload, S>

  type NutritionPlanCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<NutritionPlanFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: NutritionPlanCountAggregateInputType | true
    }

  export interface NutritionPlanDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['NutritionPlan'], meta: { name: 'NutritionPlan' } }
    /**
     * Find zero or one NutritionPlan that matches the filter.
     * @param {NutritionPlanFindUniqueArgs} args - Arguments to find a NutritionPlan
     * @example
     * // Get one NutritionPlan
     * const nutritionPlan = await prisma.nutritionPlan.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends NutritionPlanFindUniqueArgs>(args: SelectSubset<T, NutritionPlanFindUniqueArgs<ExtArgs>>): Prisma__NutritionPlanClient<$Result.GetResult<Prisma.$NutritionPlanPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one NutritionPlan that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {NutritionPlanFindUniqueOrThrowArgs} args - Arguments to find a NutritionPlan
     * @example
     * // Get one NutritionPlan
     * const nutritionPlan = await prisma.nutritionPlan.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends NutritionPlanFindUniqueOrThrowArgs>(args: SelectSubset<T, NutritionPlanFindUniqueOrThrowArgs<ExtArgs>>): Prisma__NutritionPlanClient<$Result.GetResult<Prisma.$NutritionPlanPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first NutritionPlan that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {NutritionPlanFindFirstArgs} args - Arguments to find a NutritionPlan
     * @example
     * // Get one NutritionPlan
     * const nutritionPlan = await prisma.nutritionPlan.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends NutritionPlanFindFirstArgs>(args?: SelectSubset<T, NutritionPlanFindFirstArgs<ExtArgs>>): Prisma__NutritionPlanClient<$Result.GetResult<Prisma.$NutritionPlanPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first NutritionPlan that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {NutritionPlanFindFirstOrThrowArgs} args - Arguments to find a NutritionPlan
     * @example
     * // Get one NutritionPlan
     * const nutritionPlan = await prisma.nutritionPlan.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends NutritionPlanFindFirstOrThrowArgs>(args?: SelectSubset<T, NutritionPlanFindFirstOrThrowArgs<ExtArgs>>): Prisma__NutritionPlanClient<$Result.GetResult<Prisma.$NutritionPlanPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more NutritionPlans that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {NutritionPlanFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all NutritionPlans
     * const nutritionPlans = await prisma.nutritionPlan.findMany()
     * 
     * // Get first 10 NutritionPlans
     * const nutritionPlans = await prisma.nutritionPlan.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const nutritionPlanWithIdOnly = await prisma.nutritionPlan.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends NutritionPlanFindManyArgs>(args?: SelectSubset<T, NutritionPlanFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$NutritionPlanPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a NutritionPlan.
     * @param {NutritionPlanCreateArgs} args - Arguments to create a NutritionPlan.
     * @example
     * // Create one NutritionPlan
     * const NutritionPlan = await prisma.nutritionPlan.create({
     *   data: {
     *     // ... data to create a NutritionPlan
     *   }
     * })
     * 
     */
    create<T extends NutritionPlanCreateArgs>(args: SelectSubset<T, NutritionPlanCreateArgs<ExtArgs>>): Prisma__NutritionPlanClient<$Result.GetResult<Prisma.$NutritionPlanPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many NutritionPlans.
     * @param {NutritionPlanCreateManyArgs} args - Arguments to create many NutritionPlans.
     * @example
     * // Create many NutritionPlans
     * const nutritionPlan = await prisma.nutritionPlan.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends NutritionPlanCreateManyArgs>(args?: SelectSubset<T, NutritionPlanCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many NutritionPlans and returns the data saved in the database.
     * @param {NutritionPlanCreateManyAndReturnArgs} args - Arguments to create many NutritionPlans.
     * @example
     * // Create many NutritionPlans
     * const nutritionPlan = await prisma.nutritionPlan.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many NutritionPlans and only return the `id`
     * const nutritionPlanWithIdOnly = await prisma.nutritionPlan.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends NutritionPlanCreateManyAndReturnArgs>(args?: SelectSubset<T, NutritionPlanCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$NutritionPlanPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a NutritionPlan.
     * @param {NutritionPlanDeleteArgs} args - Arguments to delete one NutritionPlan.
     * @example
     * // Delete one NutritionPlan
     * const NutritionPlan = await prisma.nutritionPlan.delete({
     *   where: {
     *     // ... filter to delete one NutritionPlan
     *   }
     * })
     * 
     */
    delete<T extends NutritionPlanDeleteArgs>(args: SelectSubset<T, NutritionPlanDeleteArgs<ExtArgs>>): Prisma__NutritionPlanClient<$Result.GetResult<Prisma.$NutritionPlanPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one NutritionPlan.
     * @param {NutritionPlanUpdateArgs} args - Arguments to update one NutritionPlan.
     * @example
     * // Update one NutritionPlan
     * const nutritionPlan = await prisma.nutritionPlan.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends NutritionPlanUpdateArgs>(args: SelectSubset<T, NutritionPlanUpdateArgs<ExtArgs>>): Prisma__NutritionPlanClient<$Result.GetResult<Prisma.$NutritionPlanPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more NutritionPlans.
     * @param {NutritionPlanDeleteManyArgs} args - Arguments to filter NutritionPlans to delete.
     * @example
     * // Delete a few NutritionPlans
     * const { count } = await prisma.nutritionPlan.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends NutritionPlanDeleteManyArgs>(args?: SelectSubset<T, NutritionPlanDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more NutritionPlans.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {NutritionPlanUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many NutritionPlans
     * const nutritionPlan = await prisma.nutritionPlan.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends NutritionPlanUpdateManyArgs>(args: SelectSubset<T, NutritionPlanUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one NutritionPlan.
     * @param {NutritionPlanUpsertArgs} args - Arguments to update or create a NutritionPlan.
     * @example
     * // Update or create a NutritionPlan
     * const nutritionPlan = await prisma.nutritionPlan.upsert({
     *   create: {
     *     // ... data to create a NutritionPlan
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the NutritionPlan we want to update
     *   }
     * })
     */
    upsert<T extends NutritionPlanUpsertArgs>(args: SelectSubset<T, NutritionPlanUpsertArgs<ExtArgs>>): Prisma__NutritionPlanClient<$Result.GetResult<Prisma.$NutritionPlanPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of NutritionPlans.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {NutritionPlanCountArgs} args - Arguments to filter NutritionPlans to count.
     * @example
     * // Count the number of NutritionPlans
     * const count = await prisma.nutritionPlan.count({
     *   where: {
     *     // ... the filter for the NutritionPlans we want to count
     *   }
     * })
    **/
    count<T extends NutritionPlanCountArgs>(
      args?: Subset<T, NutritionPlanCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], NutritionPlanCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a NutritionPlan.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {NutritionPlanAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends NutritionPlanAggregateArgs>(args: Subset<T, NutritionPlanAggregateArgs>): Prisma.PrismaPromise<GetNutritionPlanAggregateType<T>>

    /**
     * Group by NutritionPlan.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {NutritionPlanGroupByArgs} args - Group by arguments.
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
      T extends NutritionPlanGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: NutritionPlanGroupByArgs['orderBy'] }
        : { orderBy?: NutritionPlanGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, NutritionPlanGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetNutritionPlanGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the NutritionPlan model
   */
  readonly fields: NutritionPlanFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for NutritionPlan.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__NutritionPlanClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
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
   * Fields of the NutritionPlan model
   */ 
  interface NutritionPlanFieldRefs {
    readonly id: FieldRef<"NutritionPlan", 'String'>
    readonly userId: FieldRef<"NutritionPlan", 'String'>
    readonly name: FieldRef<"NutritionPlan", 'String'>
    readonly goal: FieldRef<"NutritionPlan", 'String'>
    readonly durationWeeks: FieldRef<"NutritionPlan", 'Int'>
    readonly mealsPerDay: FieldRef<"NutritionPlan", 'Int'>
    readonly plan: FieldRef<"NutritionPlan", 'Json'>
    readonly status: FieldRef<"NutritionPlan", 'PlanStatus'>
    readonly jobId: FieldRef<"NutritionPlan", 'String'>
    readonly failReason: FieldRef<"NutritionPlan", 'String'>
    readonly archivedAt: FieldRef<"NutritionPlan", 'DateTime'>
    readonly createdAt: FieldRef<"NutritionPlan", 'DateTime'>
    readonly updatedAt: FieldRef<"NutritionPlan", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * NutritionPlan findUnique
   */
  export type NutritionPlanFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the NutritionPlan
     */
    select?: NutritionPlanSelect<ExtArgs> | null
    /**
     * Filter, which NutritionPlan to fetch.
     */
    where: NutritionPlanWhereUniqueInput
  }

  /**
   * NutritionPlan findUniqueOrThrow
   */
  export type NutritionPlanFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the NutritionPlan
     */
    select?: NutritionPlanSelect<ExtArgs> | null
    /**
     * Filter, which NutritionPlan to fetch.
     */
    where: NutritionPlanWhereUniqueInput
  }

  /**
   * NutritionPlan findFirst
   */
  export type NutritionPlanFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the NutritionPlan
     */
    select?: NutritionPlanSelect<ExtArgs> | null
    /**
     * Filter, which NutritionPlan to fetch.
     */
    where?: NutritionPlanWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of NutritionPlans to fetch.
     */
    orderBy?: NutritionPlanOrderByWithRelationInput | NutritionPlanOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for NutritionPlans.
     */
    cursor?: NutritionPlanWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` NutritionPlans from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` NutritionPlans.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of NutritionPlans.
     */
    distinct?: NutritionPlanScalarFieldEnum | NutritionPlanScalarFieldEnum[]
  }

  /**
   * NutritionPlan findFirstOrThrow
   */
  export type NutritionPlanFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the NutritionPlan
     */
    select?: NutritionPlanSelect<ExtArgs> | null
    /**
     * Filter, which NutritionPlan to fetch.
     */
    where?: NutritionPlanWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of NutritionPlans to fetch.
     */
    orderBy?: NutritionPlanOrderByWithRelationInput | NutritionPlanOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for NutritionPlans.
     */
    cursor?: NutritionPlanWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` NutritionPlans from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` NutritionPlans.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of NutritionPlans.
     */
    distinct?: NutritionPlanScalarFieldEnum | NutritionPlanScalarFieldEnum[]
  }

  /**
   * NutritionPlan findMany
   */
  export type NutritionPlanFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the NutritionPlan
     */
    select?: NutritionPlanSelect<ExtArgs> | null
    /**
     * Filter, which NutritionPlans to fetch.
     */
    where?: NutritionPlanWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of NutritionPlans to fetch.
     */
    orderBy?: NutritionPlanOrderByWithRelationInput | NutritionPlanOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing NutritionPlans.
     */
    cursor?: NutritionPlanWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` NutritionPlans from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` NutritionPlans.
     */
    skip?: number
    distinct?: NutritionPlanScalarFieldEnum | NutritionPlanScalarFieldEnum[]
  }

  /**
   * NutritionPlan create
   */
  export type NutritionPlanCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the NutritionPlan
     */
    select?: NutritionPlanSelect<ExtArgs> | null
    /**
     * The data needed to create a NutritionPlan.
     */
    data: XOR<NutritionPlanCreateInput, NutritionPlanUncheckedCreateInput>
  }

  /**
   * NutritionPlan createMany
   */
  export type NutritionPlanCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many NutritionPlans.
     */
    data: NutritionPlanCreateManyInput | NutritionPlanCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * NutritionPlan createManyAndReturn
   */
  export type NutritionPlanCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the NutritionPlan
     */
    select?: NutritionPlanSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many NutritionPlans.
     */
    data: NutritionPlanCreateManyInput | NutritionPlanCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * NutritionPlan update
   */
  export type NutritionPlanUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the NutritionPlan
     */
    select?: NutritionPlanSelect<ExtArgs> | null
    /**
     * The data needed to update a NutritionPlan.
     */
    data: XOR<NutritionPlanUpdateInput, NutritionPlanUncheckedUpdateInput>
    /**
     * Choose, which NutritionPlan to update.
     */
    where: NutritionPlanWhereUniqueInput
  }

  /**
   * NutritionPlan updateMany
   */
  export type NutritionPlanUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update NutritionPlans.
     */
    data: XOR<NutritionPlanUpdateManyMutationInput, NutritionPlanUncheckedUpdateManyInput>
    /**
     * Filter which NutritionPlans to update
     */
    where?: NutritionPlanWhereInput
  }

  /**
   * NutritionPlan upsert
   */
  export type NutritionPlanUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the NutritionPlan
     */
    select?: NutritionPlanSelect<ExtArgs> | null
    /**
     * The filter to search for the NutritionPlan to update in case it exists.
     */
    where: NutritionPlanWhereUniqueInput
    /**
     * In case the NutritionPlan found by the `where` argument doesn't exist, create a new NutritionPlan with this data.
     */
    create: XOR<NutritionPlanCreateInput, NutritionPlanUncheckedCreateInput>
    /**
     * In case the NutritionPlan was found with the provided `where` argument, update it with this data.
     */
    update: XOR<NutritionPlanUpdateInput, NutritionPlanUncheckedUpdateInput>
  }

  /**
   * NutritionPlan delete
   */
  export type NutritionPlanDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the NutritionPlan
     */
    select?: NutritionPlanSelect<ExtArgs> | null
    /**
     * Filter which NutritionPlan to delete.
     */
    where: NutritionPlanWhereUniqueInput
  }

  /**
   * NutritionPlan deleteMany
   */
  export type NutritionPlanDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which NutritionPlans to delete
     */
    where?: NutritionPlanWhereInput
  }

  /**
   * NutritionPlan without action
   */
  export type NutritionPlanDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the NutritionPlan
     */
    select?: NutritionPlanSelect<ExtArgs> | null
  }


  /**
   * Model KnowledgeSource
   */

  export type AggregateKnowledgeSource = {
    _count: KnowledgeSourceCountAggregateOutputType | null
    _avg: KnowledgeSourceAvgAggregateOutputType | null
    _sum: KnowledgeSourceSumAggregateOutputType | null
    _min: KnowledgeSourceMinAggregateOutputType | null
    _max: KnowledgeSourceMaxAggregateOutputType | null
  }

  export type KnowledgeSourceAvgAggregateOutputType = {
    trustTier: number | null
  }

  export type KnowledgeSourceSumAggregateOutputType = {
    trustTier: number | null
  }

  export type KnowledgeSourceMinAggregateOutputType = {
    id: string | null
    name: string | null
    baseUrl: string | null
    sourceType: $Enums.KnowledgeSourceType | null
    trustTier: number | null
    crawlCron: string | null
    isActive: boolean | null
    lastCrawledAt: Date | null
    createdAt: Date | null
  }

  export type KnowledgeSourceMaxAggregateOutputType = {
    id: string | null
    name: string | null
    baseUrl: string | null
    sourceType: $Enums.KnowledgeSourceType | null
    trustTier: number | null
    crawlCron: string | null
    isActive: boolean | null
    lastCrawledAt: Date | null
    createdAt: Date | null
  }

  export type KnowledgeSourceCountAggregateOutputType = {
    id: number
    name: number
    baseUrl: number
    sourceType: number
    trustTier: number
    crawlCron: number
    isActive: number
    lastCrawledAt: number
    createdAt: number
    _all: number
  }


  export type KnowledgeSourceAvgAggregateInputType = {
    trustTier?: true
  }

  export type KnowledgeSourceSumAggregateInputType = {
    trustTier?: true
  }

  export type KnowledgeSourceMinAggregateInputType = {
    id?: true
    name?: true
    baseUrl?: true
    sourceType?: true
    trustTier?: true
    crawlCron?: true
    isActive?: true
    lastCrawledAt?: true
    createdAt?: true
  }

  export type KnowledgeSourceMaxAggregateInputType = {
    id?: true
    name?: true
    baseUrl?: true
    sourceType?: true
    trustTier?: true
    crawlCron?: true
    isActive?: true
    lastCrawledAt?: true
    createdAt?: true
  }

  export type KnowledgeSourceCountAggregateInputType = {
    id?: true
    name?: true
    baseUrl?: true
    sourceType?: true
    trustTier?: true
    crawlCron?: true
    isActive?: true
    lastCrawledAt?: true
    createdAt?: true
    _all?: true
  }

  export type KnowledgeSourceAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which KnowledgeSource to aggregate.
     */
    where?: KnowledgeSourceWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of KnowledgeSources to fetch.
     */
    orderBy?: KnowledgeSourceOrderByWithRelationInput | KnowledgeSourceOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: KnowledgeSourceWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` KnowledgeSources from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` KnowledgeSources.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned KnowledgeSources
    **/
    _count?: true | KnowledgeSourceCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: KnowledgeSourceAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: KnowledgeSourceSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: KnowledgeSourceMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: KnowledgeSourceMaxAggregateInputType
  }

  export type GetKnowledgeSourceAggregateType<T extends KnowledgeSourceAggregateArgs> = {
        [P in keyof T & keyof AggregateKnowledgeSource]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateKnowledgeSource[P]>
      : GetScalarType<T[P], AggregateKnowledgeSource[P]>
  }




  export type KnowledgeSourceGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: KnowledgeSourceWhereInput
    orderBy?: KnowledgeSourceOrderByWithAggregationInput | KnowledgeSourceOrderByWithAggregationInput[]
    by: KnowledgeSourceScalarFieldEnum[] | KnowledgeSourceScalarFieldEnum
    having?: KnowledgeSourceScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: KnowledgeSourceCountAggregateInputType | true
    _avg?: KnowledgeSourceAvgAggregateInputType
    _sum?: KnowledgeSourceSumAggregateInputType
    _min?: KnowledgeSourceMinAggregateInputType
    _max?: KnowledgeSourceMaxAggregateInputType
  }

  export type KnowledgeSourceGroupByOutputType = {
    id: string
    name: string
    baseUrl: string
    sourceType: $Enums.KnowledgeSourceType
    trustTier: number
    crawlCron: string
    isActive: boolean
    lastCrawledAt: Date | null
    createdAt: Date
    _count: KnowledgeSourceCountAggregateOutputType | null
    _avg: KnowledgeSourceAvgAggregateOutputType | null
    _sum: KnowledgeSourceSumAggregateOutputType | null
    _min: KnowledgeSourceMinAggregateOutputType | null
    _max: KnowledgeSourceMaxAggregateOutputType | null
  }

  type GetKnowledgeSourceGroupByPayload<T extends KnowledgeSourceGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<KnowledgeSourceGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof KnowledgeSourceGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], KnowledgeSourceGroupByOutputType[P]>
            : GetScalarType<T[P], KnowledgeSourceGroupByOutputType[P]>
        }
      >
    >


  export type KnowledgeSourceSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    name?: boolean
    baseUrl?: boolean
    sourceType?: boolean
    trustTier?: boolean
    crawlCron?: boolean
    isActive?: boolean
    lastCrawledAt?: boolean
    createdAt?: boolean
    documents?: boolean | KnowledgeSource$documentsArgs<ExtArgs>
    _count?: boolean | KnowledgeSourceCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["knowledgeSource"]>

  export type KnowledgeSourceSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    name?: boolean
    baseUrl?: boolean
    sourceType?: boolean
    trustTier?: boolean
    crawlCron?: boolean
    isActive?: boolean
    lastCrawledAt?: boolean
    createdAt?: boolean
  }, ExtArgs["result"]["knowledgeSource"]>

  export type KnowledgeSourceSelectScalar = {
    id?: boolean
    name?: boolean
    baseUrl?: boolean
    sourceType?: boolean
    trustTier?: boolean
    crawlCron?: boolean
    isActive?: boolean
    lastCrawledAt?: boolean
    createdAt?: boolean
  }

  export type KnowledgeSourceInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    documents?: boolean | KnowledgeSource$documentsArgs<ExtArgs>
    _count?: boolean | KnowledgeSourceCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type KnowledgeSourceIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {}

  export type $KnowledgeSourcePayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "KnowledgeSource"
    objects: {
      documents: Prisma.$KnowledgeDocumentPayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      name: string
      baseUrl: string
      sourceType: $Enums.KnowledgeSourceType
      trustTier: number
      crawlCron: string
      isActive: boolean
      lastCrawledAt: Date | null
      createdAt: Date
    }, ExtArgs["result"]["knowledgeSource"]>
    composites: {}
  }

  type KnowledgeSourceGetPayload<S extends boolean | null | undefined | KnowledgeSourceDefaultArgs> = $Result.GetResult<Prisma.$KnowledgeSourcePayload, S>

  type KnowledgeSourceCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<KnowledgeSourceFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: KnowledgeSourceCountAggregateInputType | true
    }

  export interface KnowledgeSourceDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['KnowledgeSource'], meta: { name: 'KnowledgeSource' } }
    /**
     * Find zero or one KnowledgeSource that matches the filter.
     * @param {KnowledgeSourceFindUniqueArgs} args - Arguments to find a KnowledgeSource
     * @example
     * // Get one KnowledgeSource
     * const knowledgeSource = await prisma.knowledgeSource.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends KnowledgeSourceFindUniqueArgs>(args: SelectSubset<T, KnowledgeSourceFindUniqueArgs<ExtArgs>>): Prisma__KnowledgeSourceClient<$Result.GetResult<Prisma.$KnowledgeSourcePayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one KnowledgeSource that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {KnowledgeSourceFindUniqueOrThrowArgs} args - Arguments to find a KnowledgeSource
     * @example
     * // Get one KnowledgeSource
     * const knowledgeSource = await prisma.knowledgeSource.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends KnowledgeSourceFindUniqueOrThrowArgs>(args: SelectSubset<T, KnowledgeSourceFindUniqueOrThrowArgs<ExtArgs>>): Prisma__KnowledgeSourceClient<$Result.GetResult<Prisma.$KnowledgeSourcePayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first KnowledgeSource that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {KnowledgeSourceFindFirstArgs} args - Arguments to find a KnowledgeSource
     * @example
     * // Get one KnowledgeSource
     * const knowledgeSource = await prisma.knowledgeSource.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends KnowledgeSourceFindFirstArgs>(args?: SelectSubset<T, KnowledgeSourceFindFirstArgs<ExtArgs>>): Prisma__KnowledgeSourceClient<$Result.GetResult<Prisma.$KnowledgeSourcePayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first KnowledgeSource that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {KnowledgeSourceFindFirstOrThrowArgs} args - Arguments to find a KnowledgeSource
     * @example
     * // Get one KnowledgeSource
     * const knowledgeSource = await prisma.knowledgeSource.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends KnowledgeSourceFindFirstOrThrowArgs>(args?: SelectSubset<T, KnowledgeSourceFindFirstOrThrowArgs<ExtArgs>>): Prisma__KnowledgeSourceClient<$Result.GetResult<Prisma.$KnowledgeSourcePayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more KnowledgeSources that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {KnowledgeSourceFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all KnowledgeSources
     * const knowledgeSources = await prisma.knowledgeSource.findMany()
     * 
     * // Get first 10 KnowledgeSources
     * const knowledgeSources = await prisma.knowledgeSource.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const knowledgeSourceWithIdOnly = await prisma.knowledgeSource.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends KnowledgeSourceFindManyArgs>(args?: SelectSubset<T, KnowledgeSourceFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$KnowledgeSourcePayload<ExtArgs>, T, "findMany">>

    /**
     * Create a KnowledgeSource.
     * @param {KnowledgeSourceCreateArgs} args - Arguments to create a KnowledgeSource.
     * @example
     * // Create one KnowledgeSource
     * const KnowledgeSource = await prisma.knowledgeSource.create({
     *   data: {
     *     // ... data to create a KnowledgeSource
     *   }
     * })
     * 
     */
    create<T extends KnowledgeSourceCreateArgs>(args: SelectSubset<T, KnowledgeSourceCreateArgs<ExtArgs>>): Prisma__KnowledgeSourceClient<$Result.GetResult<Prisma.$KnowledgeSourcePayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many KnowledgeSources.
     * @param {KnowledgeSourceCreateManyArgs} args - Arguments to create many KnowledgeSources.
     * @example
     * // Create many KnowledgeSources
     * const knowledgeSource = await prisma.knowledgeSource.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends KnowledgeSourceCreateManyArgs>(args?: SelectSubset<T, KnowledgeSourceCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many KnowledgeSources and returns the data saved in the database.
     * @param {KnowledgeSourceCreateManyAndReturnArgs} args - Arguments to create many KnowledgeSources.
     * @example
     * // Create many KnowledgeSources
     * const knowledgeSource = await prisma.knowledgeSource.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many KnowledgeSources and only return the `id`
     * const knowledgeSourceWithIdOnly = await prisma.knowledgeSource.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends KnowledgeSourceCreateManyAndReturnArgs>(args?: SelectSubset<T, KnowledgeSourceCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$KnowledgeSourcePayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a KnowledgeSource.
     * @param {KnowledgeSourceDeleteArgs} args - Arguments to delete one KnowledgeSource.
     * @example
     * // Delete one KnowledgeSource
     * const KnowledgeSource = await prisma.knowledgeSource.delete({
     *   where: {
     *     // ... filter to delete one KnowledgeSource
     *   }
     * })
     * 
     */
    delete<T extends KnowledgeSourceDeleteArgs>(args: SelectSubset<T, KnowledgeSourceDeleteArgs<ExtArgs>>): Prisma__KnowledgeSourceClient<$Result.GetResult<Prisma.$KnowledgeSourcePayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one KnowledgeSource.
     * @param {KnowledgeSourceUpdateArgs} args - Arguments to update one KnowledgeSource.
     * @example
     * // Update one KnowledgeSource
     * const knowledgeSource = await prisma.knowledgeSource.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends KnowledgeSourceUpdateArgs>(args: SelectSubset<T, KnowledgeSourceUpdateArgs<ExtArgs>>): Prisma__KnowledgeSourceClient<$Result.GetResult<Prisma.$KnowledgeSourcePayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more KnowledgeSources.
     * @param {KnowledgeSourceDeleteManyArgs} args - Arguments to filter KnowledgeSources to delete.
     * @example
     * // Delete a few KnowledgeSources
     * const { count } = await prisma.knowledgeSource.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends KnowledgeSourceDeleteManyArgs>(args?: SelectSubset<T, KnowledgeSourceDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more KnowledgeSources.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {KnowledgeSourceUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many KnowledgeSources
     * const knowledgeSource = await prisma.knowledgeSource.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends KnowledgeSourceUpdateManyArgs>(args: SelectSubset<T, KnowledgeSourceUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one KnowledgeSource.
     * @param {KnowledgeSourceUpsertArgs} args - Arguments to update or create a KnowledgeSource.
     * @example
     * // Update or create a KnowledgeSource
     * const knowledgeSource = await prisma.knowledgeSource.upsert({
     *   create: {
     *     // ... data to create a KnowledgeSource
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the KnowledgeSource we want to update
     *   }
     * })
     */
    upsert<T extends KnowledgeSourceUpsertArgs>(args: SelectSubset<T, KnowledgeSourceUpsertArgs<ExtArgs>>): Prisma__KnowledgeSourceClient<$Result.GetResult<Prisma.$KnowledgeSourcePayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of KnowledgeSources.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {KnowledgeSourceCountArgs} args - Arguments to filter KnowledgeSources to count.
     * @example
     * // Count the number of KnowledgeSources
     * const count = await prisma.knowledgeSource.count({
     *   where: {
     *     // ... the filter for the KnowledgeSources we want to count
     *   }
     * })
    **/
    count<T extends KnowledgeSourceCountArgs>(
      args?: Subset<T, KnowledgeSourceCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], KnowledgeSourceCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a KnowledgeSource.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {KnowledgeSourceAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends KnowledgeSourceAggregateArgs>(args: Subset<T, KnowledgeSourceAggregateArgs>): Prisma.PrismaPromise<GetKnowledgeSourceAggregateType<T>>

    /**
     * Group by KnowledgeSource.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {KnowledgeSourceGroupByArgs} args - Group by arguments.
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
      T extends KnowledgeSourceGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: KnowledgeSourceGroupByArgs['orderBy'] }
        : { orderBy?: KnowledgeSourceGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, KnowledgeSourceGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetKnowledgeSourceGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the KnowledgeSource model
   */
  readonly fields: KnowledgeSourceFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for KnowledgeSource.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__KnowledgeSourceClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    documents<T extends KnowledgeSource$documentsArgs<ExtArgs> = {}>(args?: Subset<T, KnowledgeSource$documentsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$KnowledgeDocumentPayload<ExtArgs>, T, "findMany"> | Null>
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
   * Fields of the KnowledgeSource model
   */ 
  interface KnowledgeSourceFieldRefs {
    readonly id: FieldRef<"KnowledgeSource", 'String'>
    readonly name: FieldRef<"KnowledgeSource", 'String'>
    readonly baseUrl: FieldRef<"KnowledgeSource", 'String'>
    readonly sourceType: FieldRef<"KnowledgeSource", 'KnowledgeSourceType'>
    readonly trustTier: FieldRef<"KnowledgeSource", 'Int'>
    readonly crawlCron: FieldRef<"KnowledgeSource", 'String'>
    readonly isActive: FieldRef<"KnowledgeSource", 'Boolean'>
    readonly lastCrawledAt: FieldRef<"KnowledgeSource", 'DateTime'>
    readonly createdAt: FieldRef<"KnowledgeSource", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * KnowledgeSource findUnique
   */
  export type KnowledgeSourceFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeSource
     */
    select?: KnowledgeSourceSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeSourceInclude<ExtArgs> | null
    /**
     * Filter, which KnowledgeSource to fetch.
     */
    where: KnowledgeSourceWhereUniqueInput
  }

  /**
   * KnowledgeSource findUniqueOrThrow
   */
  export type KnowledgeSourceFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeSource
     */
    select?: KnowledgeSourceSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeSourceInclude<ExtArgs> | null
    /**
     * Filter, which KnowledgeSource to fetch.
     */
    where: KnowledgeSourceWhereUniqueInput
  }

  /**
   * KnowledgeSource findFirst
   */
  export type KnowledgeSourceFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeSource
     */
    select?: KnowledgeSourceSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeSourceInclude<ExtArgs> | null
    /**
     * Filter, which KnowledgeSource to fetch.
     */
    where?: KnowledgeSourceWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of KnowledgeSources to fetch.
     */
    orderBy?: KnowledgeSourceOrderByWithRelationInput | KnowledgeSourceOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for KnowledgeSources.
     */
    cursor?: KnowledgeSourceWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` KnowledgeSources from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` KnowledgeSources.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of KnowledgeSources.
     */
    distinct?: KnowledgeSourceScalarFieldEnum | KnowledgeSourceScalarFieldEnum[]
  }

  /**
   * KnowledgeSource findFirstOrThrow
   */
  export type KnowledgeSourceFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeSource
     */
    select?: KnowledgeSourceSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeSourceInclude<ExtArgs> | null
    /**
     * Filter, which KnowledgeSource to fetch.
     */
    where?: KnowledgeSourceWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of KnowledgeSources to fetch.
     */
    orderBy?: KnowledgeSourceOrderByWithRelationInput | KnowledgeSourceOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for KnowledgeSources.
     */
    cursor?: KnowledgeSourceWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` KnowledgeSources from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` KnowledgeSources.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of KnowledgeSources.
     */
    distinct?: KnowledgeSourceScalarFieldEnum | KnowledgeSourceScalarFieldEnum[]
  }

  /**
   * KnowledgeSource findMany
   */
  export type KnowledgeSourceFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeSource
     */
    select?: KnowledgeSourceSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeSourceInclude<ExtArgs> | null
    /**
     * Filter, which KnowledgeSources to fetch.
     */
    where?: KnowledgeSourceWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of KnowledgeSources to fetch.
     */
    orderBy?: KnowledgeSourceOrderByWithRelationInput | KnowledgeSourceOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing KnowledgeSources.
     */
    cursor?: KnowledgeSourceWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` KnowledgeSources from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` KnowledgeSources.
     */
    skip?: number
    distinct?: KnowledgeSourceScalarFieldEnum | KnowledgeSourceScalarFieldEnum[]
  }

  /**
   * KnowledgeSource create
   */
  export type KnowledgeSourceCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeSource
     */
    select?: KnowledgeSourceSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeSourceInclude<ExtArgs> | null
    /**
     * The data needed to create a KnowledgeSource.
     */
    data: XOR<KnowledgeSourceCreateInput, KnowledgeSourceUncheckedCreateInput>
  }

  /**
   * KnowledgeSource createMany
   */
  export type KnowledgeSourceCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many KnowledgeSources.
     */
    data: KnowledgeSourceCreateManyInput | KnowledgeSourceCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * KnowledgeSource createManyAndReturn
   */
  export type KnowledgeSourceCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeSource
     */
    select?: KnowledgeSourceSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many KnowledgeSources.
     */
    data: KnowledgeSourceCreateManyInput | KnowledgeSourceCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * KnowledgeSource update
   */
  export type KnowledgeSourceUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeSource
     */
    select?: KnowledgeSourceSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeSourceInclude<ExtArgs> | null
    /**
     * The data needed to update a KnowledgeSource.
     */
    data: XOR<KnowledgeSourceUpdateInput, KnowledgeSourceUncheckedUpdateInput>
    /**
     * Choose, which KnowledgeSource to update.
     */
    where: KnowledgeSourceWhereUniqueInput
  }

  /**
   * KnowledgeSource updateMany
   */
  export type KnowledgeSourceUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update KnowledgeSources.
     */
    data: XOR<KnowledgeSourceUpdateManyMutationInput, KnowledgeSourceUncheckedUpdateManyInput>
    /**
     * Filter which KnowledgeSources to update
     */
    where?: KnowledgeSourceWhereInput
  }

  /**
   * KnowledgeSource upsert
   */
  export type KnowledgeSourceUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeSource
     */
    select?: KnowledgeSourceSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeSourceInclude<ExtArgs> | null
    /**
     * The filter to search for the KnowledgeSource to update in case it exists.
     */
    where: KnowledgeSourceWhereUniqueInput
    /**
     * In case the KnowledgeSource found by the `where` argument doesn't exist, create a new KnowledgeSource with this data.
     */
    create: XOR<KnowledgeSourceCreateInput, KnowledgeSourceUncheckedCreateInput>
    /**
     * In case the KnowledgeSource was found with the provided `where` argument, update it with this data.
     */
    update: XOR<KnowledgeSourceUpdateInput, KnowledgeSourceUncheckedUpdateInput>
  }

  /**
   * KnowledgeSource delete
   */
  export type KnowledgeSourceDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeSource
     */
    select?: KnowledgeSourceSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeSourceInclude<ExtArgs> | null
    /**
     * Filter which KnowledgeSource to delete.
     */
    where: KnowledgeSourceWhereUniqueInput
  }

  /**
   * KnowledgeSource deleteMany
   */
  export type KnowledgeSourceDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which KnowledgeSources to delete
     */
    where?: KnowledgeSourceWhereInput
  }

  /**
   * KnowledgeSource.documents
   */
  export type KnowledgeSource$documentsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeDocument
     */
    select?: KnowledgeDocumentSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeDocumentInclude<ExtArgs> | null
    where?: KnowledgeDocumentWhereInput
    orderBy?: KnowledgeDocumentOrderByWithRelationInput | KnowledgeDocumentOrderByWithRelationInput[]
    cursor?: KnowledgeDocumentWhereUniqueInput
    take?: number
    skip?: number
    distinct?: KnowledgeDocumentScalarFieldEnum | KnowledgeDocumentScalarFieldEnum[]
  }

  /**
   * KnowledgeSource without action
   */
  export type KnowledgeSourceDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeSource
     */
    select?: KnowledgeSourceSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeSourceInclude<ExtArgs> | null
  }


  /**
   * Model KnowledgeDocument
   */

  export type AggregateKnowledgeDocument = {
    _count: KnowledgeDocumentCountAggregateOutputType | null
    _avg: KnowledgeDocumentAvgAggregateOutputType | null
    _sum: KnowledgeDocumentSumAggregateOutputType | null
    _min: KnowledgeDocumentMinAggregateOutputType | null
    _max: KnowledgeDocumentMaxAggregateOutputType | null
  }

  export type KnowledgeDocumentAvgAggregateOutputType = {
    trustScore: Decimal | null
    qualityScore: Decimal | null
  }

  export type KnowledgeDocumentSumAggregateOutputType = {
    trustScore: Decimal | null
    qualityScore: Decimal | null
  }

  export type KnowledgeDocumentMinAggregateOutputType = {
    id: string | null
    sourceId: string | null
    url: string | null
    title: string | null
    author: string | null
    language: string | null
    contentHash: string | null
    rawObjectKey: string | null
    cleanText: string | null
    topic: $Enums.KnowledgeDocumentTopic | null
    trustScore: Decimal | null
    qualityScore: Decimal | null
    safetyFlag: boolean | null
    status: $Enums.KnowledgeDocumentStatus | null
    rejectionReason: string | null
    publishedAt: Date | null
    crawledAt: Date | null
    processedAt: Date | null
  }

  export type KnowledgeDocumentMaxAggregateOutputType = {
    id: string | null
    sourceId: string | null
    url: string | null
    title: string | null
    author: string | null
    language: string | null
    contentHash: string | null
    rawObjectKey: string | null
    cleanText: string | null
    topic: $Enums.KnowledgeDocumentTopic | null
    trustScore: Decimal | null
    qualityScore: Decimal | null
    safetyFlag: boolean | null
    status: $Enums.KnowledgeDocumentStatus | null
    rejectionReason: string | null
    publishedAt: Date | null
    crawledAt: Date | null
    processedAt: Date | null
  }

  export type KnowledgeDocumentCountAggregateOutputType = {
    id: number
    sourceId: number
    url: number
    title: number
    author: number
    language: number
    contentHash: number
    rawObjectKey: number
    cleanText: number
    topic: number
    trustScore: number
    qualityScore: number
    safetyFlag: number
    status: number
    rejectionReason: number
    publishedAt: number
    crawledAt: number
    processedAt: number
    _all: number
  }


  export type KnowledgeDocumentAvgAggregateInputType = {
    trustScore?: true
    qualityScore?: true
  }

  export type KnowledgeDocumentSumAggregateInputType = {
    trustScore?: true
    qualityScore?: true
  }

  export type KnowledgeDocumentMinAggregateInputType = {
    id?: true
    sourceId?: true
    url?: true
    title?: true
    author?: true
    language?: true
    contentHash?: true
    rawObjectKey?: true
    cleanText?: true
    topic?: true
    trustScore?: true
    qualityScore?: true
    safetyFlag?: true
    status?: true
    rejectionReason?: true
    publishedAt?: true
    crawledAt?: true
    processedAt?: true
  }

  export type KnowledgeDocumentMaxAggregateInputType = {
    id?: true
    sourceId?: true
    url?: true
    title?: true
    author?: true
    language?: true
    contentHash?: true
    rawObjectKey?: true
    cleanText?: true
    topic?: true
    trustScore?: true
    qualityScore?: true
    safetyFlag?: true
    status?: true
    rejectionReason?: true
    publishedAt?: true
    crawledAt?: true
    processedAt?: true
  }

  export type KnowledgeDocumentCountAggregateInputType = {
    id?: true
    sourceId?: true
    url?: true
    title?: true
    author?: true
    language?: true
    contentHash?: true
    rawObjectKey?: true
    cleanText?: true
    topic?: true
    trustScore?: true
    qualityScore?: true
    safetyFlag?: true
    status?: true
    rejectionReason?: true
    publishedAt?: true
    crawledAt?: true
    processedAt?: true
    _all?: true
  }

  export type KnowledgeDocumentAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which KnowledgeDocument to aggregate.
     */
    where?: KnowledgeDocumentWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of KnowledgeDocuments to fetch.
     */
    orderBy?: KnowledgeDocumentOrderByWithRelationInput | KnowledgeDocumentOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: KnowledgeDocumentWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` KnowledgeDocuments from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` KnowledgeDocuments.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned KnowledgeDocuments
    **/
    _count?: true | KnowledgeDocumentCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: KnowledgeDocumentAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: KnowledgeDocumentSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: KnowledgeDocumentMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: KnowledgeDocumentMaxAggregateInputType
  }

  export type GetKnowledgeDocumentAggregateType<T extends KnowledgeDocumentAggregateArgs> = {
        [P in keyof T & keyof AggregateKnowledgeDocument]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateKnowledgeDocument[P]>
      : GetScalarType<T[P], AggregateKnowledgeDocument[P]>
  }




  export type KnowledgeDocumentGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: KnowledgeDocumentWhereInput
    orderBy?: KnowledgeDocumentOrderByWithAggregationInput | KnowledgeDocumentOrderByWithAggregationInput[]
    by: KnowledgeDocumentScalarFieldEnum[] | KnowledgeDocumentScalarFieldEnum
    having?: KnowledgeDocumentScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: KnowledgeDocumentCountAggregateInputType | true
    _avg?: KnowledgeDocumentAvgAggregateInputType
    _sum?: KnowledgeDocumentSumAggregateInputType
    _min?: KnowledgeDocumentMinAggregateInputType
    _max?: KnowledgeDocumentMaxAggregateInputType
  }

  export type KnowledgeDocumentGroupByOutputType = {
    id: string
    sourceId: string
    url: string
    title: string | null
    author: string | null
    language: string | null
    contentHash: string
    rawObjectKey: string | null
    cleanText: string | null
    topic: $Enums.KnowledgeDocumentTopic | null
    trustScore: Decimal | null
    qualityScore: Decimal | null
    safetyFlag: boolean
    status: $Enums.KnowledgeDocumentStatus
    rejectionReason: string | null
    publishedAt: Date | null
    crawledAt: Date
    processedAt: Date | null
    _count: KnowledgeDocumentCountAggregateOutputType | null
    _avg: KnowledgeDocumentAvgAggregateOutputType | null
    _sum: KnowledgeDocumentSumAggregateOutputType | null
    _min: KnowledgeDocumentMinAggregateOutputType | null
    _max: KnowledgeDocumentMaxAggregateOutputType | null
  }

  type GetKnowledgeDocumentGroupByPayload<T extends KnowledgeDocumentGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<KnowledgeDocumentGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof KnowledgeDocumentGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], KnowledgeDocumentGroupByOutputType[P]>
            : GetScalarType<T[P], KnowledgeDocumentGroupByOutputType[P]>
        }
      >
    >


  export type KnowledgeDocumentSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    sourceId?: boolean
    url?: boolean
    title?: boolean
    author?: boolean
    language?: boolean
    contentHash?: boolean
    rawObjectKey?: boolean
    cleanText?: boolean
    topic?: boolean
    trustScore?: boolean
    qualityScore?: boolean
    safetyFlag?: boolean
    status?: boolean
    rejectionReason?: boolean
    publishedAt?: boolean
    crawledAt?: boolean
    processedAt?: boolean
    source?: boolean | KnowledgeSourceDefaultArgs<ExtArgs>
    chunks?: boolean | KnowledgeDocument$chunksArgs<ExtArgs>
    reviewItems?: boolean | KnowledgeDocument$reviewItemsArgs<ExtArgs>
    _count?: boolean | KnowledgeDocumentCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["knowledgeDocument"]>

  export type KnowledgeDocumentSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    sourceId?: boolean
    url?: boolean
    title?: boolean
    author?: boolean
    language?: boolean
    contentHash?: boolean
    rawObjectKey?: boolean
    cleanText?: boolean
    topic?: boolean
    trustScore?: boolean
    qualityScore?: boolean
    safetyFlag?: boolean
    status?: boolean
    rejectionReason?: boolean
    publishedAt?: boolean
    crawledAt?: boolean
    processedAt?: boolean
    source?: boolean | KnowledgeSourceDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["knowledgeDocument"]>

  export type KnowledgeDocumentSelectScalar = {
    id?: boolean
    sourceId?: boolean
    url?: boolean
    title?: boolean
    author?: boolean
    language?: boolean
    contentHash?: boolean
    rawObjectKey?: boolean
    cleanText?: boolean
    topic?: boolean
    trustScore?: boolean
    qualityScore?: boolean
    safetyFlag?: boolean
    status?: boolean
    rejectionReason?: boolean
    publishedAt?: boolean
    crawledAt?: boolean
    processedAt?: boolean
  }

  export type KnowledgeDocumentInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    source?: boolean | KnowledgeSourceDefaultArgs<ExtArgs>
    chunks?: boolean | KnowledgeDocument$chunksArgs<ExtArgs>
    reviewItems?: boolean | KnowledgeDocument$reviewItemsArgs<ExtArgs>
    _count?: boolean | KnowledgeDocumentCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type KnowledgeDocumentIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    source?: boolean | KnowledgeSourceDefaultArgs<ExtArgs>
  }

  export type $KnowledgeDocumentPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "KnowledgeDocument"
    objects: {
      source: Prisma.$KnowledgeSourcePayload<ExtArgs>
      chunks: Prisma.$KnowledgeChunkPayload<ExtArgs>[]
      reviewItems: Prisma.$KnowledgeReviewItemPayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      sourceId: string
      url: string
      title: string | null
      author: string | null
      language: string | null
      contentHash: string
      rawObjectKey: string | null
      cleanText: string | null
      topic: $Enums.KnowledgeDocumentTopic | null
      trustScore: Prisma.Decimal | null
      qualityScore: Prisma.Decimal | null
      safetyFlag: boolean
      status: $Enums.KnowledgeDocumentStatus
      rejectionReason: string | null
      publishedAt: Date | null
      crawledAt: Date
      processedAt: Date | null
    }, ExtArgs["result"]["knowledgeDocument"]>
    composites: {}
  }

  type KnowledgeDocumentGetPayload<S extends boolean | null | undefined | KnowledgeDocumentDefaultArgs> = $Result.GetResult<Prisma.$KnowledgeDocumentPayload, S>

  type KnowledgeDocumentCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<KnowledgeDocumentFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: KnowledgeDocumentCountAggregateInputType | true
    }

  export interface KnowledgeDocumentDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['KnowledgeDocument'], meta: { name: 'KnowledgeDocument' } }
    /**
     * Find zero or one KnowledgeDocument that matches the filter.
     * @param {KnowledgeDocumentFindUniqueArgs} args - Arguments to find a KnowledgeDocument
     * @example
     * // Get one KnowledgeDocument
     * const knowledgeDocument = await prisma.knowledgeDocument.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends KnowledgeDocumentFindUniqueArgs>(args: SelectSubset<T, KnowledgeDocumentFindUniqueArgs<ExtArgs>>): Prisma__KnowledgeDocumentClient<$Result.GetResult<Prisma.$KnowledgeDocumentPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one KnowledgeDocument that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {KnowledgeDocumentFindUniqueOrThrowArgs} args - Arguments to find a KnowledgeDocument
     * @example
     * // Get one KnowledgeDocument
     * const knowledgeDocument = await prisma.knowledgeDocument.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends KnowledgeDocumentFindUniqueOrThrowArgs>(args: SelectSubset<T, KnowledgeDocumentFindUniqueOrThrowArgs<ExtArgs>>): Prisma__KnowledgeDocumentClient<$Result.GetResult<Prisma.$KnowledgeDocumentPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first KnowledgeDocument that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {KnowledgeDocumentFindFirstArgs} args - Arguments to find a KnowledgeDocument
     * @example
     * // Get one KnowledgeDocument
     * const knowledgeDocument = await prisma.knowledgeDocument.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends KnowledgeDocumentFindFirstArgs>(args?: SelectSubset<T, KnowledgeDocumentFindFirstArgs<ExtArgs>>): Prisma__KnowledgeDocumentClient<$Result.GetResult<Prisma.$KnowledgeDocumentPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first KnowledgeDocument that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {KnowledgeDocumentFindFirstOrThrowArgs} args - Arguments to find a KnowledgeDocument
     * @example
     * // Get one KnowledgeDocument
     * const knowledgeDocument = await prisma.knowledgeDocument.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends KnowledgeDocumentFindFirstOrThrowArgs>(args?: SelectSubset<T, KnowledgeDocumentFindFirstOrThrowArgs<ExtArgs>>): Prisma__KnowledgeDocumentClient<$Result.GetResult<Prisma.$KnowledgeDocumentPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more KnowledgeDocuments that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {KnowledgeDocumentFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all KnowledgeDocuments
     * const knowledgeDocuments = await prisma.knowledgeDocument.findMany()
     * 
     * // Get first 10 KnowledgeDocuments
     * const knowledgeDocuments = await prisma.knowledgeDocument.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const knowledgeDocumentWithIdOnly = await prisma.knowledgeDocument.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends KnowledgeDocumentFindManyArgs>(args?: SelectSubset<T, KnowledgeDocumentFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$KnowledgeDocumentPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a KnowledgeDocument.
     * @param {KnowledgeDocumentCreateArgs} args - Arguments to create a KnowledgeDocument.
     * @example
     * // Create one KnowledgeDocument
     * const KnowledgeDocument = await prisma.knowledgeDocument.create({
     *   data: {
     *     // ... data to create a KnowledgeDocument
     *   }
     * })
     * 
     */
    create<T extends KnowledgeDocumentCreateArgs>(args: SelectSubset<T, KnowledgeDocumentCreateArgs<ExtArgs>>): Prisma__KnowledgeDocumentClient<$Result.GetResult<Prisma.$KnowledgeDocumentPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many KnowledgeDocuments.
     * @param {KnowledgeDocumentCreateManyArgs} args - Arguments to create many KnowledgeDocuments.
     * @example
     * // Create many KnowledgeDocuments
     * const knowledgeDocument = await prisma.knowledgeDocument.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends KnowledgeDocumentCreateManyArgs>(args?: SelectSubset<T, KnowledgeDocumentCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many KnowledgeDocuments and returns the data saved in the database.
     * @param {KnowledgeDocumentCreateManyAndReturnArgs} args - Arguments to create many KnowledgeDocuments.
     * @example
     * // Create many KnowledgeDocuments
     * const knowledgeDocument = await prisma.knowledgeDocument.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many KnowledgeDocuments and only return the `id`
     * const knowledgeDocumentWithIdOnly = await prisma.knowledgeDocument.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends KnowledgeDocumentCreateManyAndReturnArgs>(args?: SelectSubset<T, KnowledgeDocumentCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$KnowledgeDocumentPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a KnowledgeDocument.
     * @param {KnowledgeDocumentDeleteArgs} args - Arguments to delete one KnowledgeDocument.
     * @example
     * // Delete one KnowledgeDocument
     * const KnowledgeDocument = await prisma.knowledgeDocument.delete({
     *   where: {
     *     // ... filter to delete one KnowledgeDocument
     *   }
     * })
     * 
     */
    delete<T extends KnowledgeDocumentDeleteArgs>(args: SelectSubset<T, KnowledgeDocumentDeleteArgs<ExtArgs>>): Prisma__KnowledgeDocumentClient<$Result.GetResult<Prisma.$KnowledgeDocumentPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one KnowledgeDocument.
     * @param {KnowledgeDocumentUpdateArgs} args - Arguments to update one KnowledgeDocument.
     * @example
     * // Update one KnowledgeDocument
     * const knowledgeDocument = await prisma.knowledgeDocument.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends KnowledgeDocumentUpdateArgs>(args: SelectSubset<T, KnowledgeDocumentUpdateArgs<ExtArgs>>): Prisma__KnowledgeDocumentClient<$Result.GetResult<Prisma.$KnowledgeDocumentPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more KnowledgeDocuments.
     * @param {KnowledgeDocumentDeleteManyArgs} args - Arguments to filter KnowledgeDocuments to delete.
     * @example
     * // Delete a few KnowledgeDocuments
     * const { count } = await prisma.knowledgeDocument.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends KnowledgeDocumentDeleteManyArgs>(args?: SelectSubset<T, KnowledgeDocumentDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more KnowledgeDocuments.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {KnowledgeDocumentUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many KnowledgeDocuments
     * const knowledgeDocument = await prisma.knowledgeDocument.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends KnowledgeDocumentUpdateManyArgs>(args: SelectSubset<T, KnowledgeDocumentUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one KnowledgeDocument.
     * @param {KnowledgeDocumentUpsertArgs} args - Arguments to update or create a KnowledgeDocument.
     * @example
     * // Update or create a KnowledgeDocument
     * const knowledgeDocument = await prisma.knowledgeDocument.upsert({
     *   create: {
     *     // ... data to create a KnowledgeDocument
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the KnowledgeDocument we want to update
     *   }
     * })
     */
    upsert<T extends KnowledgeDocumentUpsertArgs>(args: SelectSubset<T, KnowledgeDocumentUpsertArgs<ExtArgs>>): Prisma__KnowledgeDocumentClient<$Result.GetResult<Prisma.$KnowledgeDocumentPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of KnowledgeDocuments.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {KnowledgeDocumentCountArgs} args - Arguments to filter KnowledgeDocuments to count.
     * @example
     * // Count the number of KnowledgeDocuments
     * const count = await prisma.knowledgeDocument.count({
     *   where: {
     *     // ... the filter for the KnowledgeDocuments we want to count
     *   }
     * })
    **/
    count<T extends KnowledgeDocumentCountArgs>(
      args?: Subset<T, KnowledgeDocumentCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], KnowledgeDocumentCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a KnowledgeDocument.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {KnowledgeDocumentAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends KnowledgeDocumentAggregateArgs>(args: Subset<T, KnowledgeDocumentAggregateArgs>): Prisma.PrismaPromise<GetKnowledgeDocumentAggregateType<T>>

    /**
     * Group by KnowledgeDocument.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {KnowledgeDocumentGroupByArgs} args - Group by arguments.
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
      T extends KnowledgeDocumentGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: KnowledgeDocumentGroupByArgs['orderBy'] }
        : { orderBy?: KnowledgeDocumentGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, KnowledgeDocumentGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetKnowledgeDocumentGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the KnowledgeDocument model
   */
  readonly fields: KnowledgeDocumentFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for KnowledgeDocument.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__KnowledgeDocumentClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    source<T extends KnowledgeSourceDefaultArgs<ExtArgs> = {}>(args?: Subset<T, KnowledgeSourceDefaultArgs<ExtArgs>>): Prisma__KnowledgeSourceClient<$Result.GetResult<Prisma.$KnowledgeSourcePayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
    chunks<T extends KnowledgeDocument$chunksArgs<ExtArgs> = {}>(args?: Subset<T, KnowledgeDocument$chunksArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$KnowledgeChunkPayload<ExtArgs>, T, "findMany"> | Null>
    reviewItems<T extends KnowledgeDocument$reviewItemsArgs<ExtArgs> = {}>(args?: Subset<T, KnowledgeDocument$reviewItemsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$KnowledgeReviewItemPayload<ExtArgs>, T, "findMany"> | Null>
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
   * Fields of the KnowledgeDocument model
   */ 
  interface KnowledgeDocumentFieldRefs {
    readonly id: FieldRef<"KnowledgeDocument", 'String'>
    readonly sourceId: FieldRef<"KnowledgeDocument", 'String'>
    readonly url: FieldRef<"KnowledgeDocument", 'String'>
    readonly title: FieldRef<"KnowledgeDocument", 'String'>
    readonly author: FieldRef<"KnowledgeDocument", 'String'>
    readonly language: FieldRef<"KnowledgeDocument", 'String'>
    readonly contentHash: FieldRef<"KnowledgeDocument", 'String'>
    readonly rawObjectKey: FieldRef<"KnowledgeDocument", 'String'>
    readonly cleanText: FieldRef<"KnowledgeDocument", 'String'>
    readonly topic: FieldRef<"KnowledgeDocument", 'KnowledgeDocumentTopic'>
    readonly trustScore: FieldRef<"KnowledgeDocument", 'Decimal'>
    readonly qualityScore: FieldRef<"KnowledgeDocument", 'Decimal'>
    readonly safetyFlag: FieldRef<"KnowledgeDocument", 'Boolean'>
    readonly status: FieldRef<"KnowledgeDocument", 'KnowledgeDocumentStatus'>
    readonly rejectionReason: FieldRef<"KnowledgeDocument", 'String'>
    readonly publishedAt: FieldRef<"KnowledgeDocument", 'DateTime'>
    readonly crawledAt: FieldRef<"KnowledgeDocument", 'DateTime'>
    readonly processedAt: FieldRef<"KnowledgeDocument", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * KnowledgeDocument findUnique
   */
  export type KnowledgeDocumentFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeDocument
     */
    select?: KnowledgeDocumentSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeDocumentInclude<ExtArgs> | null
    /**
     * Filter, which KnowledgeDocument to fetch.
     */
    where: KnowledgeDocumentWhereUniqueInput
  }

  /**
   * KnowledgeDocument findUniqueOrThrow
   */
  export type KnowledgeDocumentFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeDocument
     */
    select?: KnowledgeDocumentSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeDocumentInclude<ExtArgs> | null
    /**
     * Filter, which KnowledgeDocument to fetch.
     */
    where: KnowledgeDocumentWhereUniqueInput
  }

  /**
   * KnowledgeDocument findFirst
   */
  export type KnowledgeDocumentFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeDocument
     */
    select?: KnowledgeDocumentSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeDocumentInclude<ExtArgs> | null
    /**
     * Filter, which KnowledgeDocument to fetch.
     */
    where?: KnowledgeDocumentWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of KnowledgeDocuments to fetch.
     */
    orderBy?: KnowledgeDocumentOrderByWithRelationInput | KnowledgeDocumentOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for KnowledgeDocuments.
     */
    cursor?: KnowledgeDocumentWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` KnowledgeDocuments from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` KnowledgeDocuments.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of KnowledgeDocuments.
     */
    distinct?: KnowledgeDocumentScalarFieldEnum | KnowledgeDocumentScalarFieldEnum[]
  }

  /**
   * KnowledgeDocument findFirstOrThrow
   */
  export type KnowledgeDocumentFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeDocument
     */
    select?: KnowledgeDocumentSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeDocumentInclude<ExtArgs> | null
    /**
     * Filter, which KnowledgeDocument to fetch.
     */
    where?: KnowledgeDocumentWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of KnowledgeDocuments to fetch.
     */
    orderBy?: KnowledgeDocumentOrderByWithRelationInput | KnowledgeDocumentOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for KnowledgeDocuments.
     */
    cursor?: KnowledgeDocumentWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` KnowledgeDocuments from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` KnowledgeDocuments.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of KnowledgeDocuments.
     */
    distinct?: KnowledgeDocumentScalarFieldEnum | KnowledgeDocumentScalarFieldEnum[]
  }

  /**
   * KnowledgeDocument findMany
   */
  export type KnowledgeDocumentFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeDocument
     */
    select?: KnowledgeDocumentSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeDocumentInclude<ExtArgs> | null
    /**
     * Filter, which KnowledgeDocuments to fetch.
     */
    where?: KnowledgeDocumentWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of KnowledgeDocuments to fetch.
     */
    orderBy?: KnowledgeDocumentOrderByWithRelationInput | KnowledgeDocumentOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing KnowledgeDocuments.
     */
    cursor?: KnowledgeDocumentWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` KnowledgeDocuments from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` KnowledgeDocuments.
     */
    skip?: number
    distinct?: KnowledgeDocumentScalarFieldEnum | KnowledgeDocumentScalarFieldEnum[]
  }

  /**
   * KnowledgeDocument create
   */
  export type KnowledgeDocumentCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeDocument
     */
    select?: KnowledgeDocumentSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeDocumentInclude<ExtArgs> | null
    /**
     * The data needed to create a KnowledgeDocument.
     */
    data: XOR<KnowledgeDocumentCreateInput, KnowledgeDocumentUncheckedCreateInput>
  }

  /**
   * KnowledgeDocument createMany
   */
  export type KnowledgeDocumentCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many KnowledgeDocuments.
     */
    data: KnowledgeDocumentCreateManyInput | KnowledgeDocumentCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * KnowledgeDocument createManyAndReturn
   */
  export type KnowledgeDocumentCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeDocument
     */
    select?: KnowledgeDocumentSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many KnowledgeDocuments.
     */
    data: KnowledgeDocumentCreateManyInput | KnowledgeDocumentCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeDocumentIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * KnowledgeDocument update
   */
  export type KnowledgeDocumentUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeDocument
     */
    select?: KnowledgeDocumentSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeDocumentInclude<ExtArgs> | null
    /**
     * The data needed to update a KnowledgeDocument.
     */
    data: XOR<KnowledgeDocumentUpdateInput, KnowledgeDocumentUncheckedUpdateInput>
    /**
     * Choose, which KnowledgeDocument to update.
     */
    where: KnowledgeDocumentWhereUniqueInput
  }

  /**
   * KnowledgeDocument updateMany
   */
  export type KnowledgeDocumentUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update KnowledgeDocuments.
     */
    data: XOR<KnowledgeDocumentUpdateManyMutationInput, KnowledgeDocumentUncheckedUpdateManyInput>
    /**
     * Filter which KnowledgeDocuments to update
     */
    where?: KnowledgeDocumentWhereInput
  }

  /**
   * KnowledgeDocument upsert
   */
  export type KnowledgeDocumentUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeDocument
     */
    select?: KnowledgeDocumentSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeDocumentInclude<ExtArgs> | null
    /**
     * The filter to search for the KnowledgeDocument to update in case it exists.
     */
    where: KnowledgeDocumentWhereUniqueInput
    /**
     * In case the KnowledgeDocument found by the `where` argument doesn't exist, create a new KnowledgeDocument with this data.
     */
    create: XOR<KnowledgeDocumentCreateInput, KnowledgeDocumentUncheckedCreateInput>
    /**
     * In case the KnowledgeDocument was found with the provided `where` argument, update it with this data.
     */
    update: XOR<KnowledgeDocumentUpdateInput, KnowledgeDocumentUncheckedUpdateInput>
  }

  /**
   * KnowledgeDocument delete
   */
  export type KnowledgeDocumentDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeDocument
     */
    select?: KnowledgeDocumentSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeDocumentInclude<ExtArgs> | null
    /**
     * Filter which KnowledgeDocument to delete.
     */
    where: KnowledgeDocumentWhereUniqueInput
  }

  /**
   * KnowledgeDocument deleteMany
   */
  export type KnowledgeDocumentDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which KnowledgeDocuments to delete
     */
    where?: KnowledgeDocumentWhereInput
  }

  /**
   * KnowledgeDocument.chunks
   */
  export type KnowledgeDocument$chunksArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeChunk
     */
    select?: KnowledgeChunkSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeChunkInclude<ExtArgs> | null
    where?: KnowledgeChunkWhereInput
    orderBy?: KnowledgeChunkOrderByWithRelationInput | KnowledgeChunkOrderByWithRelationInput[]
    cursor?: KnowledgeChunkWhereUniqueInput
    take?: number
    skip?: number
    distinct?: KnowledgeChunkScalarFieldEnum | KnowledgeChunkScalarFieldEnum[]
  }

  /**
   * KnowledgeDocument.reviewItems
   */
  export type KnowledgeDocument$reviewItemsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeReviewItem
     */
    select?: KnowledgeReviewItemSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeReviewItemInclude<ExtArgs> | null
    where?: KnowledgeReviewItemWhereInput
    orderBy?: KnowledgeReviewItemOrderByWithRelationInput | KnowledgeReviewItemOrderByWithRelationInput[]
    cursor?: KnowledgeReviewItemWhereUniqueInput
    take?: number
    skip?: number
    distinct?: KnowledgeReviewItemScalarFieldEnum | KnowledgeReviewItemScalarFieldEnum[]
  }

  /**
   * KnowledgeDocument without action
   */
  export type KnowledgeDocumentDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeDocument
     */
    select?: KnowledgeDocumentSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeDocumentInclude<ExtArgs> | null
  }


  /**
   * Model KnowledgeChunk
   */

  export type AggregateKnowledgeChunk = {
    _count: KnowledgeChunkCountAggregateOutputType | null
    _avg: KnowledgeChunkAvgAggregateOutputType | null
    _sum: KnowledgeChunkSumAggregateOutputType | null
    _min: KnowledgeChunkMinAggregateOutputType | null
    _max: KnowledgeChunkMaxAggregateOutputType | null
  }

  export type KnowledgeChunkAvgAggregateOutputType = {
    chunkIndex: number | null
    tokenCount: number | null
  }

  export type KnowledgeChunkSumAggregateOutputType = {
    chunkIndex: number | null
    tokenCount: number | null
  }

  export type KnowledgeChunkMinAggregateOutputType = {
    id: string | null
    documentId: string | null
    chunkIndex: number | null
    text: string | null
    tokenCount: number | null
    vectorId: string | null
    embeddedAt: Date | null
  }

  export type KnowledgeChunkMaxAggregateOutputType = {
    id: string | null
    documentId: string | null
    chunkIndex: number | null
    text: string | null
    tokenCount: number | null
    vectorId: string | null
    embeddedAt: Date | null
  }

  export type KnowledgeChunkCountAggregateOutputType = {
    id: number
    documentId: number
    chunkIndex: number
    text: number
    tokenCount: number
    vectorId: number
    embeddedAt: number
    _all: number
  }


  export type KnowledgeChunkAvgAggregateInputType = {
    chunkIndex?: true
    tokenCount?: true
  }

  export type KnowledgeChunkSumAggregateInputType = {
    chunkIndex?: true
    tokenCount?: true
  }

  export type KnowledgeChunkMinAggregateInputType = {
    id?: true
    documentId?: true
    chunkIndex?: true
    text?: true
    tokenCount?: true
    vectorId?: true
    embeddedAt?: true
  }

  export type KnowledgeChunkMaxAggregateInputType = {
    id?: true
    documentId?: true
    chunkIndex?: true
    text?: true
    tokenCount?: true
    vectorId?: true
    embeddedAt?: true
  }

  export type KnowledgeChunkCountAggregateInputType = {
    id?: true
    documentId?: true
    chunkIndex?: true
    text?: true
    tokenCount?: true
    vectorId?: true
    embeddedAt?: true
    _all?: true
  }

  export type KnowledgeChunkAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which KnowledgeChunk to aggregate.
     */
    where?: KnowledgeChunkWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of KnowledgeChunks to fetch.
     */
    orderBy?: KnowledgeChunkOrderByWithRelationInput | KnowledgeChunkOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: KnowledgeChunkWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` KnowledgeChunks from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` KnowledgeChunks.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned KnowledgeChunks
    **/
    _count?: true | KnowledgeChunkCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: KnowledgeChunkAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: KnowledgeChunkSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: KnowledgeChunkMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: KnowledgeChunkMaxAggregateInputType
  }

  export type GetKnowledgeChunkAggregateType<T extends KnowledgeChunkAggregateArgs> = {
        [P in keyof T & keyof AggregateKnowledgeChunk]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateKnowledgeChunk[P]>
      : GetScalarType<T[P], AggregateKnowledgeChunk[P]>
  }




  export type KnowledgeChunkGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: KnowledgeChunkWhereInput
    orderBy?: KnowledgeChunkOrderByWithAggregationInput | KnowledgeChunkOrderByWithAggregationInput[]
    by: KnowledgeChunkScalarFieldEnum[] | KnowledgeChunkScalarFieldEnum
    having?: KnowledgeChunkScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: KnowledgeChunkCountAggregateInputType | true
    _avg?: KnowledgeChunkAvgAggregateInputType
    _sum?: KnowledgeChunkSumAggregateInputType
    _min?: KnowledgeChunkMinAggregateInputType
    _max?: KnowledgeChunkMaxAggregateInputType
  }

  export type KnowledgeChunkGroupByOutputType = {
    id: string
    documentId: string
    chunkIndex: number
    text: string
    tokenCount: number | null
    vectorId: string
    embeddedAt: Date
    _count: KnowledgeChunkCountAggregateOutputType | null
    _avg: KnowledgeChunkAvgAggregateOutputType | null
    _sum: KnowledgeChunkSumAggregateOutputType | null
    _min: KnowledgeChunkMinAggregateOutputType | null
    _max: KnowledgeChunkMaxAggregateOutputType | null
  }

  type GetKnowledgeChunkGroupByPayload<T extends KnowledgeChunkGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<KnowledgeChunkGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof KnowledgeChunkGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], KnowledgeChunkGroupByOutputType[P]>
            : GetScalarType<T[P], KnowledgeChunkGroupByOutputType[P]>
        }
      >
    >


  export type KnowledgeChunkSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    documentId?: boolean
    chunkIndex?: boolean
    text?: boolean
    tokenCount?: boolean
    vectorId?: boolean
    embeddedAt?: boolean
    document?: boolean | KnowledgeDocumentDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["knowledgeChunk"]>

  export type KnowledgeChunkSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    documentId?: boolean
    chunkIndex?: boolean
    text?: boolean
    tokenCount?: boolean
    vectorId?: boolean
    embeddedAt?: boolean
    document?: boolean | KnowledgeDocumentDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["knowledgeChunk"]>

  export type KnowledgeChunkSelectScalar = {
    id?: boolean
    documentId?: boolean
    chunkIndex?: boolean
    text?: boolean
    tokenCount?: boolean
    vectorId?: boolean
    embeddedAt?: boolean
  }

  export type KnowledgeChunkInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    document?: boolean | KnowledgeDocumentDefaultArgs<ExtArgs>
  }
  export type KnowledgeChunkIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    document?: boolean | KnowledgeDocumentDefaultArgs<ExtArgs>
  }

  export type $KnowledgeChunkPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "KnowledgeChunk"
    objects: {
      document: Prisma.$KnowledgeDocumentPayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      documentId: string
      chunkIndex: number
      text: string
      tokenCount: number | null
      vectorId: string
      embeddedAt: Date
    }, ExtArgs["result"]["knowledgeChunk"]>
    composites: {}
  }

  type KnowledgeChunkGetPayload<S extends boolean | null | undefined | KnowledgeChunkDefaultArgs> = $Result.GetResult<Prisma.$KnowledgeChunkPayload, S>

  type KnowledgeChunkCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<KnowledgeChunkFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: KnowledgeChunkCountAggregateInputType | true
    }

  export interface KnowledgeChunkDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['KnowledgeChunk'], meta: { name: 'KnowledgeChunk' } }
    /**
     * Find zero or one KnowledgeChunk that matches the filter.
     * @param {KnowledgeChunkFindUniqueArgs} args - Arguments to find a KnowledgeChunk
     * @example
     * // Get one KnowledgeChunk
     * const knowledgeChunk = await prisma.knowledgeChunk.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends KnowledgeChunkFindUniqueArgs>(args: SelectSubset<T, KnowledgeChunkFindUniqueArgs<ExtArgs>>): Prisma__KnowledgeChunkClient<$Result.GetResult<Prisma.$KnowledgeChunkPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one KnowledgeChunk that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {KnowledgeChunkFindUniqueOrThrowArgs} args - Arguments to find a KnowledgeChunk
     * @example
     * // Get one KnowledgeChunk
     * const knowledgeChunk = await prisma.knowledgeChunk.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends KnowledgeChunkFindUniqueOrThrowArgs>(args: SelectSubset<T, KnowledgeChunkFindUniqueOrThrowArgs<ExtArgs>>): Prisma__KnowledgeChunkClient<$Result.GetResult<Prisma.$KnowledgeChunkPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first KnowledgeChunk that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {KnowledgeChunkFindFirstArgs} args - Arguments to find a KnowledgeChunk
     * @example
     * // Get one KnowledgeChunk
     * const knowledgeChunk = await prisma.knowledgeChunk.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends KnowledgeChunkFindFirstArgs>(args?: SelectSubset<T, KnowledgeChunkFindFirstArgs<ExtArgs>>): Prisma__KnowledgeChunkClient<$Result.GetResult<Prisma.$KnowledgeChunkPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first KnowledgeChunk that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {KnowledgeChunkFindFirstOrThrowArgs} args - Arguments to find a KnowledgeChunk
     * @example
     * // Get one KnowledgeChunk
     * const knowledgeChunk = await prisma.knowledgeChunk.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends KnowledgeChunkFindFirstOrThrowArgs>(args?: SelectSubset<T, KnowledgeChunkFindFirstOrThrowArgs<ExtArgs>>): Prisma__KnowledgeChunkClient<$Result.GetResult<Prisma.$KnowledgeChunkPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more KnowledgeChunks that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {KnowledgeChunkFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all KnowledgeChunks
     * const knowledgeChunks = await prisma.knowledgeChunk.findMany()
     * 
     * // Get first 10 KnowledgeChunks
     * const knowledgeChunks = await prisma.knowledgeChunk.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const knowledgeChunkWithIdOnly = await prisma.knowledgeChunk.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends KnowledgeChunkFindManyArgs>(args?: SelectSubset<T, KnowledgeChunkFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$KnowledgeChunkPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a KnowledgeChunk.
     * @param {KnowledgeChunkCreateArgs} args - Arguments to create a KnowledgeChunk.
     * @example
     * // Create one KnowledgeChunk
     * const KnowledgeChunk = await prisma.knowledgeChunk.create({
     *   data: {
     *     // ... data to create a KnowledgeChunk
     *   }
     * })
     * 
     */
    create<T extends KnowledgeChunkCreateArgs>(args: SelectSubset<T, KnowledgeChunkCreateArgs<ExtArgs>>): Prisma__KnowledgeChunkClient<$Result.GetResult<Prisma.$KnowledgeChunkPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many KnowledgeChunks.
     * @param {KnowledgeChunkCreateManyArgs} args - Arguments to create many KnowledgeChunks.
     * @example
     * // Create many KnowledgeChunks
     * const knowledgeChunk = await prisma.knowledgeChunk.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends KnowledgeChunkCreateManyArgs>(args?: SelectSubset<T, KnowledgeChunkCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many KnowledgeChunks and returns the data saved in the database.
     * @param {KnowledgeChunkCreateManyAndReturnArgs} args - Arguments to create many KnowledgeChunks.
     * @example
     * // Create many KnowledgeChunks
     * const knowledgeChunk = await prisma.knowledgeChunk.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many KnowledgeChunks and only return the `id`
     * const knowledgeChunkWithIdOnly = await prisma.knowledgeChunk.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends KnowledgeChunkCreateManyAndReturnArgs>(args?: SelectSubset<T, KnowledgeChunkCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$KnowledgeChunkPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a KnowledgeChunk.
     * @param {KnowledgeChunkDeleteArgs} args - Arguments to delete one KnowledgeChunk.
     * @example
     * // Delete one KnowledgeChunk
     * const KnowledgeChunk = await prisma.knowledgeChunk.delete({
     *   where: {
     *     // ... filter to delete one KnowledgeChunk
     *   }
     * })
     * 
     */
    delete<T extends KnowledgeChunkDeleteArgs>(args: SelectSubset<T, KnowledgeChunkDeleteArgs<ExtArgs>>): Prisma__KnowledgeChunkClient<$Result.GetResult<Prisma.$KnowledgeChunkPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one KnowledgeChunk.
     * @param {KnowledgeChunkUpdateArgs} args - Arguments to update one KnowledgeChunk.
     * @example
     * // Update one KnowledgeChunk
     * const knowledgeChunk = await prisma.knowledgeChunk.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends KnowledgeChunkUpdateArgs>(args: SelectSubset<T, KnowledgeChunkUpdateArgs<ExtArgs>>): Prisma__KnowledgeChunkClient<$Result.GetResult<Prisma.$KnowledgeChunkPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more KnowledgeChunks.
     * @param {KnowledgeChunkDeleteManyArgs} args - Arguments to filter KnowledgeChunks to delete.
     * @example
     * // Delete a few KnowledgeChunks
     * const { count } = await prisma.knowledgeChunk.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends KnowledgeChunkDeleteManyArgs>(args?: SelectSubset<T, KnowledgeChunkDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more KnowledgeChunks.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {KnowledgeChunkUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many KnowledgeChunks
     * const knowledgeChunk = await prisma.knowledgeChunk.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends KnowledgeChunkUpdateManyArgs>(args: SelectSubset<T, KnowledgeChunkUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one KnowledgeChunk.
     * @param {KnowledgeChunkUpsertArgs} args - Arguments to update or create a KnowledgeChunk.
     * @example
     * // Update or create a KnowledgeChunk
     * const knowledgeChunk = await prisma.knowledgeChunk.upsert({
     *   create: {
     *     // ... data to create a KnowledgeChunk
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the KnowledgeChunk we want to update
     *   }
     * })
     */
    upsert<T extends KnowledgeChunkUpsertArgs>(args: SelectSubset<T, KnowledgeChunkUpsertArgs<ExtArgs>>): Prisma__KnowledgeChunkClient<$Result.GetResult<Prisma.$KnowledgeChunkPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of KnowledgeChunks.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {KnowledgeChunkCountArgs} args - Arguments to filter KnowledgeChunks to count.
     * @example
     * // Count the number of KnowledgeChunks
     * const count = await prisma.knowledgeChunk.count({
     *   where: {
     *     // ... the filter for the KnowledgeChunks we want to count
     *   }
     * })
    **/
    count<T extends KnowledgeChunkCountArgs>(
      args?: Subset<T, KnowledgeChunkCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], KnowledgeChunkCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a KnowledgeChunk.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {KnowledgeChunkAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends KnowledgeChunkAggregateArgs>(args: Subset<T, KnowledgeChunkAggregateArgs>): Prisma.PrismaPromise<GetKnowledgeChunkAggregateType<T>>

    /**
     * Group by KnowledgeChunk.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {KnowledgeChunkGroupByArgs} args - Group by arguments.
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
      T extends KnowledgeChunkGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: KnowledgeChunkGroupByArgs['orderBy'] }
        : { orderBy?: KnowledgeChunkGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, KnowledgeChunkGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetKnowledgeChunkGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the KnowledgeChunk model
   */
  readonly fields: KnowledgeChunkFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for KnowledgeChunk.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__KnowledgeChunkClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    document<T extends KnowledgeDocumentDefaultArgs<ExtArgs> = {}>(args?: Subset<T, KnowledgeDocumentDefaultArgs<ExtArgs>>): Prisma__KnowledgeDocumentClient<$Result.GetResult<Prisma.$KnowledgeDocumentPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
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
   * Fields of the KnowledgeChunk model
   */ 
  interface KnowledgeChunkFieldRefs {
    readonly id: FieldRef<"KnowledgeChunk", 'String'>
    readonly documentId: FieldRef<"KnowledgeChunk", 'String'>
    readonly chunkIndex: FieldRef<"KnowledgeChunk", 'Int'>
    readonly text: FieldRef<"KnowledgeChunk", 'String'>
    readonly tokenCount: FieldRef<"KnowledgeChunk", 'Int'>
    readonly vectorId: FieldRef<"KnowledgeChunk", 'String'>
    readonly embeddedAt: FieldRef<"KnowledgeChunk", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * KnowledgeChunk findUnique
   */
  export type KnowledgeChunkFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeChunk
     */
    select?: KnowledgeChunkSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeChunkInclude<ExtArgs> | null
    /**
     * Filter, which KnowledgeChunk to fetch.
     */
    where: KnowledgeChunkWhereUniqueInput
  }

  /**
   * KnowledgeChunk findUniqueOrThrow
   */
  export type KnowledgeChunkFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeChunk
     */
    select?: KnowledgeChunkSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeChunkInclude<ExtArgs> | null
    /**
     * Filter, which KnowledgeChunk to fetch.
     */
    where: KnowledgeChunkWhereUniqueInput
  }

  /**
   * KnowledgeChunk findFirst
   */
  export type KnowledgeChunkFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeChunk
     */
    select?: KnowledgeChunkSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeChunkInclude<ExtArgs> | null
    /**
     * Filter, which KnowledgeChunk to fetch.
     */
    where?: KnowledgeChunkWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of KnowledgeChunks to fetch.
     */
    orderBy?: KnowledgeChunkOrderByWithRelationInput | KnowledgeChunkOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for KnowledgeChunks.
     */
    cursor?: KnowledgeChunkWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` KnowledgeChunks from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` KnowledgeChunks.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of KnowledgeChunks.
     */
    distinct?: KnowledgeChunkScalarFieldEnum | KnowledgeChunkScalarFieldEnum[]
  }

  /**
   * KnowledgeChunk findFirstOrThrow
   */
  export type KnowledgeChunkFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeChunk
     */
    select?: KnowledgeChunkSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeChunkInclude<ExtArgs> | null
    /**
     * Filter, which KnowledgeChunk to fetch.
     */
    where?: KnowledgeChunkWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of KnowledgeChunks to fetch.
     */
    orderBy?: KnowledgeChunkOrderByWithRelationInput | KnowledgeChunkOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for KnowledgeChunks.
     */
    cursor?: KnowledgeChunkWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` KnowledgeChunks from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` KnowledgeChunks.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of KnowledgeChunks.
     */
    distinct?: KnowledgeChunkScalarFieldEnum | KnowledgeChunkScalarFieldEnum[]
  }

  /**
   * KnowledgeChunk findMany
   */
  export type KnowledgeChunkFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeChunk
     */
    select?: KnowledgeChunkSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeChunkInclude<ExtArgs> | null
    /**
     * Filter, which KnowledgeChunks to fetch.
     */
    where?: KnowledgeChunkWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of KnowledgeChunks to fetch.
     */
    orderBy?: KnowledgeChunkOrderByWithRelationInput | KnowledgeChunkOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing KnowledgeChunks.
     */
    cursor?: KnowledgeChunkWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` KnowledgeChunks from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` KnowledgeChunks.
     */
    skip?: number
    distinct?: KnowledgeChunkScalarFieldEnum | KnowledgeChunkScalarFieldEnum[]
  }

  /**
   * KnowledgeChunk create
   */
  export type KnowledgeChunkCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeChunk
     */
    select?: KnowledgeChunkSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeChunkInclude<ExtArgs> | null
    /**
     * The data needed to create a KnowledgeChunk.
     */
    data: XOR<KnowledgeChunkCreateInput, KnowledgeChunkUncheckedCreateInput>
  }

  /**
   * KnowledgeChunk createMany
   */
  export type KnowledgeChunkCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many KnowledgeChunks.
     */
    data: KnowledgeChunkCreateManyInput | KnowledgeChunkCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * KnowledgeChunk createManyAndReturn
   */
  export type KnowledgeChunkCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeChunk
     */
    select?: KnowledgeChunkSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many KnowledgeChunks.
     */
    data: KnowledgeChunkCreateManyInput | KnowledgeChunkCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeChunkIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * KnowledgeChunk update
   */
  export type KnowledgeChunkUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeChunk
     */
    select?: KnowledgeChunkSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeChunkInclude<ExtArgs> | null
    /**
     * The data needed to update a KnowledgeChunk.
     */
    data: XOR<KnowledgeChunkUpdateInput, KnowledgeChunkUncheckedUpdateInput>
    /**
     * Choose, which KnowledgeChunk to update.
     */
    where: KnowledgeChunkWhereUniqueInput
  }

  /**
   * KnowledgeChunk updateMany
   */
  export type KnowledgeChunkUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update KnowledgeChunks.
     */
    data: XOR<KnowledgeChunkUpdateManyMutationInput, KnowledgeChunkUncheckedUpdateManyInput>
    /**
     * Filter which KnowledgeChunks to update
     */
    where?: KnowledgeChunkWhereInput
  }

  /**
   * KnowledgeChunk upsert
   */
  export type KnowledgeChunkUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeChunk
     */
    select?: KnowledgeChunkSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeChunkInclude<ExtArgs> | null
    /**
     * The filter to search for the KnowledgeChunk to update in case it exists.
     */
    where: KnowledgeChunkWhereUniqueInput
    /**
     * In case the KnowledgeChunk found by the `where` argument doesn't exist, create a new KnowledgeChunk with this data.
     */
    create: XOR<KnowledgeChunkCreateInput, KnowledgeChunkUncheckedCreateInput>
    /**
     * In case the KnowledgeChunk was found with the provided `where` argument, update it with this data.
     */
    update: XOR<KnowledgeChunkUpdateInput, KnowledgeChunkUncheckedUpdateInput>
  }

  /**
   * KnowledgeChunk delete
   */
  export type KnowledgeChunkDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeChunk
     */
    select?: KnowledgeChunkSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeChunkInclude<ExtArgs> | null
    /**
     * Filter which KnowledgeChunk to delete.
     */
    where: KnowledgeChunkWhereUniqueInput
  }

  /**
   * KnowledgeChunk deleteMany
   */
  export type KnowledgeChunkDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which KnowledgeChunks to delete
     */
    where?: KnowledgeChunkWhereInput
  }

  /**
   * KnowledgeChunk without action
   */
  export type KnowledgeChunkDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeChunk
     */
    select?: KnowledgeChunkSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeChunkInclude<ExtArgs> | null
  }


  /**
   * Model KnowledgePipelineRun
   */

  export type AggregateKnowledgePipelineRun = {
    _count: KnowledgePipelineRunCountAggregateOutputType | null
    _avg: KnowledgePipelineRunAvgAggregateOutputType | null
    _sum: KnowledgePipelineRunSumAggregateOutputType | null
    _min: KnowledgePipelineRunMinAggregateOutputType | null
    _max: KnowledgePipelineRunMaxAggregateOutputType | null
  }

  export type KnowledgePipelineRunAvgAggregateOutputType = {
    docsCrawled: number | null
    docsAccepted: number | null
    docsRejected: number | null
    docsReview: number | null
  }

  export type KnowledgePipelineRunSumAggregateOutputType = {
    docsCrawled: number | null
    docsAccepted: number | null
    docsRejected: number | null
    docsReview: number | null
  }

  export type KnowledgePipelineRunMinAggregateOutputType = {
    id: string | null
    runType: string | null
    startedAt: Date | null
    finishedAt: Date | null
    docsCrawled: number | null
    docsAccepted: number | null
    docsRejected: number | null
    docsReview: number | null
    status: $Enums.KnowledgePipelineRunStatus | null
  }

  export type KnowledgePipelineRunMaxAggregateOutputType = {
    id: string | null
    runType: string | null
    startedAt: Date | null
    finishedAt: Date | null
    docsCrawled: number | null
    docsAccepted: number | null
    docsRejected: number | null
    docsReview: number | null
    status: $Enums.KnowledgePipelineRunStatus | null
  }

  export type KnowledgePipelineRunCountAggregateOutputType = {
    id: number
    runType: number
    startedAt: number
    finishedAt: number
    docsCrawled: number
    docsAccepted: number
    docsRejected: number
    docsReview: number
    status: number
    _all: number
  }


  export type KnowledgePipelineRunAvgAggregateInputType = {
    docsCrawled?: true
    docsAccepted?: true
    docsRejected?: true
    docsReview?: true
  }

  export type KnowledgePipelineRunSumAggregateInputType = {
    docsCrawled?: true
    docsAccepted?: true
    docsRejected?: true
    docsReview?: true
  }

  export type KnowledgePipelineRunMinAggregateInputType = {
    id?: true
    runType?: true
    startedAt?: true
    finishedAt?: true
    docsCrawled?: true
    docsAccepted?: true
    docsRejected?: true
    docsReview?: true
    status?: true
  }

  export type KnowledgePipelineRunMaxAggregateInputType = {
    id?: true
    runType?: true
    startedAt?: true
    finishedAt?: true
    docsCrawled?: true
    docsAccepted?: true
    docsRejected?: true
    docsReview?: true
    status?: true
  }

  export type KnowledgePipelineRunCountAggregateInputType = {
    id?: true
    runType?: true
    startedAt?: true
    finishedAt?: true
    docsCrawled?: true
    docsAccepted?: true
    docsRejected?: true
    docsReview?: true
    status?: true
    _all?: true
  }

  export type KnowledgePipelineRunAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which KnowledgePipelineRun to aggregate.
     */
    where?: KnowledgePipelineRunWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of KnowledgePipelineRuns to fetch.
     */
    orderBy?: KnowledgePipelineRunOrderByWithRelationInput | KnowledgePipelineRunOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: KnowledgePipelineRunWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` KnowledgePipelineRuns from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` KnowledgePipelineRuns.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned KnowledgePipelineRuns
    **/
    _count?: true | KnowledgePipelineRunCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: KnowledgePipelineRunAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: KnowledgePipelineRunSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: KnowledgePipelineRunMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: KnowledgePipelineRunMaxAggregateInputType
  }

  export type GetKnowledgePipelineRunAggregateType<T extends KnowledgePipelineRunAggregateArgs> = {
        [P in keyof T & keyof AggregateKnowledgePipelineRun]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateKnowledgePipelineRun[P]>
      : GetScalarType<T[P], AggregateKnowledgePipelineRun[P]>
  }




  export type KnowledgePipelineRunGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: KnowledgePipelineRunWhereInput
    orderBy?: KnowledgePipelineRunOrderByWithAggregationInput | KnowledgePipelineRunOrderByWithAggregationInput[]
    by: KnowledgePipelineRunScalarFieldEnum[] | KnowledgePipelineRunScalarFieldEnum
    having?: KnowledgePipelineRunScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: KnowledgePipelineRunCountAggregateInputType | true
    _avg?: KnowledgePipelineRunAvgAggregateInputType
    _sum?: KnowledgePipelineRunSumAggregateInputType
    _min?: KnowledgePipelineRunMinAggregateInputType
    _max?: KnowledgePipelineRunMaxAggregateInputType
  }

  export type KnowledgePipelineRunGroupByOutputType = {
    id: string
    runType: string
    startedAt: Date
    finishedAt: Date | null
    docsCrawled: number
    docsAccepted: number
    docsRejected: number
    docsReview: number
    status: $Enums.KnowledgePipelineRunStatus
    _count: KnowledgePipelineRunCountAggregateOutputType | null
    _avg: KnowledgePipelineRunAvgAggregateOutputType | null
    _sum: KnowledgePipelineRunSumAggregateOutputType | null
    _min: KnowledgePipelineRunMinAggregateOutputType | null
    _max: KnowledgePipelineRunMaxAggregateOutputType | null
  }

  type GetKnowledgePipelineRunGroupByPayload<T extends KnowledgePipelineRunGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<KnowledgePipelineRunGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof KnowledgePipelineRunGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], KnowledgePipelineRunGroupByOutputType[P]>
            : GetScalarType<T[P], KnowledgePipelineRunGroupByOutputType[P]>
        }
      >
    >


  export type KnowledgePipelineRunSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    runType?: boolean
    startedAt?: boolean
    finishedAt?: boolean
    docsCrawled?: boolean
    docsAccepted?: boolean
    docsRejected?: boolean
    docsReview?: boolean
    status?: boolean
  }, ExtArgs["result"]["knowledgePipelineRun"]>

  export type KnowledgePipelineRunSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    runType?: boolean
    startedAt?: boolean
    finishedAt?: boolean
    docsCrawled?: boolean
    docsAccepted?: boolean
    docsRejected?: boolean
    docsReview?: boolean
    status?: boolean
  }, ExtArgs["result"]["knowledgePipelineRun"]>

  export type KnowledgePipelineRunSelectScalar = {
    id?: boolean
    runType?: boolean
    startedAt?: boolean
    finishedAt?: boolean
    docsCrawled?: boolean
    docsAccepted?: boolean
    docsRejected?: boolean
    docsReview?: boolean
    status?: boolean
  }


  export type $KnowledgePipelineRunPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "KnowledgePipelineRun"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: string
      runType: string
      startedAt: Date
      finishedAt: Date | null
      docsCrawled: number
      docsAccepted: number
      docsRejected: number
      docsReview: number
      status: $Enums.KnowledgePipelineRunStatus
    }, ExtArgs["result"]["knowledgePipelineRun"]>
    composites: {}
  }

  type KnowledgePipelineRunGetPayload<S extends boolean | null | undefined | KnowledgePipelineRunDefaultArgs> = $Result.GetResult<Prisma.$KnowledgePipelineRunPayload, S>

  type KnowledgePipelineRunCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<KnowledgePipelineRunFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: KnowledgePipelineRunCountAggregateInputType | true
    }

  export interface KnowledgePipelineRunDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['KnowledgePipelineRun'], meta: { name: 'KnowledgePipelineRun' } }
    /**
     * Find zero or one KnowledgePipelineRun that matches the filter.
     * @param {KnowledgePipelineRunFindUniqueArgs} args - Arguments to find a KnowledgePipelineRun
     * @example
     * // Get one KnowledgePipelineRun
     * const knowledgePipelineRun = await prisma.knowledgePipelineRun.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends KnowledgePipelineRunFindUniqueArgs>(args: SelectSubset<T, KnowledgePipelineRunFindUniqueArgs<ExtArgs>>): Prisma__KnowledgePipelineRunClient<$Result.GetResult<Prisma.$KnowledgePipelineRunPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one KnowledgePipelineRun that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {KnowledgePipelineRunFindUniqueOrThrowArgs} args - Arguments to find a KnowledgePipelineRun
     * @example
     * // Get one KnowledgePipelineRun
     * const knowledgePipelineRun = await prisma.knowledgePipelineRun.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends KnowledgePipelineRunFindUniqueOrThrowArgs>(args: SelectSubset<T, KnowledgePipelineRunFindUniqueOrThrowArgs<ExtArgs>>): Prisma__KnowledgePipelineRunClient<$Result.GetResult<Prisma.$KnowledgePipelineRunPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first KnowledgePipelineRun that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {KnowledgePipelineRunFindFirstArgs} args - Arguments to find a KnowledgePipelineRun
     * @example
     * // Get one KnowledgePipelineRun
     * const knowledgePipelineRun = await prisma.knowledgePipelineRun.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends KnowledgePipelineRunFindFirstArgs>(args?: SelectSubset<T, KnowledgePipelineRunFindFirstArgs<ExtArgs>>): Prisma__KnowledgePipelineRunClient<$Result.GetResult<Prisma.$KnowledgePipelineRunPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first KnowledgePipelineRun that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {KnowledgePipelineRunFindFirstOrThrowArgs} args - Arguments to find a KnowledgePipelineRun
     * @example
     * // Get one KnowledgePipelineRun
     * const knowledgePipelineRun = await prisma.knowledgePipelineRun.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends KnowledgePipelineRunFindFirstOrThrowArgs>(args?: SelectSubset<T, KnowledgePipelineRunFindFirstOrThrowArgs<ExtArgs>>): Prisma__KnowledgePipelineRunClient<$Result.GetResult<Prisma.$KnowledgePipelineRunPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more KnowledgePipelineRuns that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {KnowledgePipelineRunFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all KnowledgePipelineRuns
     * const knowledgePipelineRuns = await prisma.knowledgePipelineRun.findMany()
     * 
     * // Get first 10 KnowledgePipelineRuns
     * const knowledgePipelineRuns = await prisma.knowledgePipelineRun.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const knowledgePipelineRunWithIdOnly = await prisma.knowledgePipelineRun.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends KnowledgePipelineRunFindManyArgs>(args?: SelectSubset<T, KnowledgePipelineRunFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$KnowledgePipelineRunPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a KnowledgePipelineRun.
     * @param {KnowledgePipelineRunCreateArgs} args - Arguments to create a KnowledgePipelineRun.
     * @example
     * // Create one KnowledgePipelineRun
     * const KnowledgePipelineRun = await prisma.knowledgePipelineRun.create({
     *   data: {
     *     // ... data to create a KnowledgePipelineRun
     *   }
     * })
     * 
     */
    create<T extends KnowledgePipelineRunCreateArgs>(args: SelectSubset<T, KnowledgePipelineRunCreateArgs<ExtArgs>>): Prisma__KnowledgePipelineRunClient<$Result.GetResult<Prisma.$KnowledgePipelineRunPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many KnowledgePipelineRuns.
     * @param {KnowledgePipelineRunCreateManyArgs} args - Arguments to create many KnowledgePipelineRuns.
     * @example
     * // Create many KnowledgePipelineRuns
     * const knowledgePipelineRun = await prisma.knowledgePipelineRun.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends KnowledgePipelineRunCreateManyArgs>(args?: SelectSubset<T, KnowledgePipelineRunCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many KnowledgePipelineRuns and returns the data saved in the database.
     * @param {KnowledgePipelineRunCreateManyAndReturnArgs} args - Arguments to create many KnowledgePipelineRuns.
     * @example
     * // Create many KnowledgePipelineRuns
     * const knowledgePipelineRun = await prisma.knowledgePipelineRun.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many KnowledgePipelineRuns and only return the `id`
     * const knowledgePipelineRunWithIdOnly = await prisma.knowledgePipelineRun.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends KnowledgePipelineRunCreateManyAndReturnArgs>(args?: SelectSubset<T, KnowledgePipelineRunCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$KnowledgePipelineRunPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a KnowledgePipelineRun.
     * @param {KnowledgePipelineRunDeleteArgs} args - Arguments to delete one KnowledgePipelineRun.
     * @example
     * // Delete one KnowledgePipelineRun
     * const KnowledgePipelineRun = await prisma.knowledgePipelineRun.delete({
     *   where: {
     *     // ... filter to delete one KnowledgePipelineRun
     *   }
     * })
     * 
     */
    delete<T extends KnowledgePipelineRunDeleteArgs>(args: SelectSubset<T, KnowledgePipelineRunDeleteArgs<ExtArgs>>): Prisma__KnowledgePipelineRunClient<$Result.GetResult<Prisma.$KnowledgePipelineRunPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one KnowledgePipelineRun.
     * @param {KnowledgePipelineRunUpdateArgs} args - Arguments to update one KnowledgePipelineRun.
     * @example
     * // Update one KnowledgePipelineRun
     * const knowledgePipelineRun = await prisma.knowledgePipelineRun.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends KnowledgePipelineRunUpdateArgs>(args: SelectSubset<T, KnowledgePipelineRunUpdateArgs<ExtArgs>>): Prisma__KnowledgePipelineRunClient<$Result.GetResult<Prisma.$KnowledgePipelineRunPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more KnowledgePipelineRuns.
     * @param {KnowledgePipelineRunDeleteManyArgs} args - Arguments to filter KnowledgePipelineRuns to delete.
     * @example
     * // Delete a few KnowledgePipelineRuns
     * const { count } = await prisma.knowledgePipelineRun.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends KnowledgePipelineRunDeleteManyArgs>(args?: SelectSubset<T, KnowledgePipelineRunDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more KnowledgePipelineRuns.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {KnowledgePipelineRunUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many KnowledgePipelineRuns
     * const knowledgePipelineRun = await prisma.knowledgePipelineRun.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends KnowledgePipelineRunUpdateManyArgs>(args: SelectSubset<T, KnowledgePipelineRunUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one KnowledgePipelineRun.
     * @param {KnowledgePipelineRunUpsertArgs} args - Arguments to update or create a KnowledgePipelineRun.
     * @example
     * // Update or create a KnowledgePipelineRun
     * const knowledgePipelineRun = await prisma.knowledgePipelineRun.upsert({
     *   create: {
     *     // ... data to create a KnowledgePipelineRun
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the KnowledgePipelineRun we want to update
     *   }
     * })
     */
    upsert<T extends KnowledgePipelineRunUpsertArgs>(args: SelectSubset<T, KnowledgePipelineRunUpsertArgs<ExtArgs>>): Prisma__KnowledgePipelineRunClient<$Result.GetResult<Prisma.$KnowledgePipelineRunPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of KnowledgePipelineRuns.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {KnowledgePipelineRunCountArgs} args - Arguments to filter KnowledgePipelineRuns to count.
     * @example
     * // Count the number of KnowledgePipelineRuns
     * const count = await prisma.knowledgePipelineRun.count({
     *   where: {
     *     // ... the filter for the KnowledgePipelineRuns we want to count
     *   }
     * })
    **/
    count<T extends KnowledgePipelineRunCountArgs>(
      args?: Subset<T, KnowledgePipelineRunCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], KnowledgePipelineRunCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a KnowledgePipelineRun.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {KnowledgePipelineRunAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends KnowledgePipelineRunAggregateArgs>(args: Subset<T, KnowledgePipelineRunAggregateArgs>): Prisma.PrismaPromise<GetKnowledgePipelineRunAggregateType<T>>

    /**
     * Group by KnowledgePipelineRun.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {KnowledgePipelineRunGroupByArgs} args - Group by arguments.
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
      T extends KnowledgePipelineRunGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: KnowledgePipelineRunGroupByArgs['orderBy'] }
        : { orderBy?: KnowledgePipelineRunGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, KnowledgePipelineRunGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetKnowledgePipelineRunGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the KnowledgePipelineRun model
   */
  readonly fields: KnowledgePipelineRunFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for KnowledgePipelineRun.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__KnowledgePipelineRunClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
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
   * Fields of the KnowledgePipelineRun model
   */ 
  interface KnowledgePipelineRunFieldRefs {
    readonly id: FieldRef<"KnowledgePipelineRun", 'String'>
    readonly runType: FieldRef<"KnowledgePipelineRun", 'String'>
    readonly startedAt: FieldRef<"KnowledgePipelineRun", 'DateTime'>
    readonly finishedAt: FieldRef<"KnowledgePipelineRun", 'DateTime'>
    readonly docsCrawled: FieldRef<"KnowledgePipelineRun", 'Int'>
    readonly docsAccepted: FieldRef<"KnowledgePipelineRun", 'Int'>
    readonly docsRejected: FieldRef<"KnowledgePipelineRun", 'Int'>
    readonly docsReview: FieldRef<"KnowledgePipelineRun", 'Int'>
    readonly status: FieldRef<"KnowledgePipelineRun", 'KnowledgePipelineRunStatus'>
  }
    

  // Custom InputTypes
  /**
   * KnowledgePipelineRun findUnique
   */
  export type KnowledgePipelineRunFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgePipelineRun
     */
    select?: KnowledgePipelineRunSelect<ExtArgs> | null
    /**
     * Filter, which KnowledgePipelineRun to fetch.
     */
    where: KnowledgePipelineRunWhereUniqueInput
  }

  /**
   * KnowledgePipelineRun findUniqueOrThrow
   */
  export type KnowledgePipelineRunFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgePipelineRun
     */
    select?: KnowledgePipelineRunSelect<ExtArgs> | null
    /**
     * Filter, which KnowledgePipelineRun to fetch.
     */
    where: KnowledgePipelineRunWhereUniqueInput
  }

  /**
   * KnowledgePipelineRun findFirst
   */
  export type KnowledgePipelineRunFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgePipelineRun
     */
    select?: KnowledgePipelineRunSelect<ExtArgs> | null
    /**
     * Filter, which KnowledgePipelineRun to fetch.
     */
    where?: KnowledgePipelineRunWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of KnowledgePipelineRuns to fetch.
     */
    orderBy?: KnowledgePipelineRunOrderByWithRelationInput | KnowledgePipelineRunOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for KnowledgePipelineRuns.
     */
    cursor?: KnowledgePipelineRunWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` KnowledgePipelineRuns from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` KnowledgePipelineRuns.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of KnowledgePipelineRuns.
     */
    distinct?: KnowledgePipelineRunScalarFieldEnum | KnowledgePipelineRunScalarFieldEnum[]
  }

  /**
   * KnowledgePipelineRun findFirstOrThrow
   */
  export type KnowledgePipelineRunFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgePipelineRun
     */
    select?: KnowledgePipelineRunSelect<ExtArgs> | null
    /**
     * Filter, which KnowledgePipelineRun to fetch.
     */
    where?: KnowledgePipelineRunWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of KnowledgePipelineRuns to fetch.
     */
    orderBy?: KnowledgePipelineRunOrderByWithRelationInput | KnowledgePipelineRunOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for KnowledgePipelineRuns.
     */
    cursor?: KnowledgePipelineRunWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` KnowledgePipelineRuns from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` KnowledgePipelineRuns.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of KnowledgePipelineRuns.
     */
    distinct?: KnowledgePipelineRunScalarFieldEnum | KnowledgePipelineRunScalarFieldEnum[]
  }

  /**
   * KnowledgePipelineRun findMany
   */
  export type KnowledgePipelineRunFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgePipelineRun
     */
    select?: KnowledgePipelineRunSelect<ExtArgs> | null
    /**
     * Filter, which KnowledgePipelineRuns to fetch.
     */
    where?: KnowledgePipelineRunWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of KnowledgePipelineRuns to fetch.
     */
    orderBy?: KnowledgePipelineRunOrderByWithRelationInput | KnowledgePipelineRunOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing KnowledgePipelineRuns.
     */
    cursor?: KnowledgePipelineRunWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` KnowledgePipelineRuns from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` KnowledgePipelineRuns.
     */
    skip?: number
    distinct?: KnowledgePipelineRunScalarFieldEnum | KnowledgePipelineRunScalarFieldEnum[]
  }

  /**
   * KnowledgePipelineRun create
   */
  export type KnowledgePipelineRunCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgePipelineRun
     */
    select?: KnowledgePipelineRunSelect<ExtArgs> | null
    /**
     * The data needed to create a KnowledgePipelineRun.
     */
    data?: XOR<KnowledgePipelineRunCreateInput, KnowledgePipelineRunUncheckedCreateInput>
  }

  /**
   * KnowledgePipelineRun createMany
   */
  export type KnowledgePipelineRunCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many KnowledgePipelineRuns.
     */
    data: KnowledgePipelineRunCreateManyInput | KnowledgePipelineRunCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * KnowledgePipelineRun createManyAndReturn
   */
  export type KnowledgePipelineRunCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgePipelineRun
     */
    select?: KnowledgePipelineRunSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many KnowledgePipelineRuns.
     */
    data: KnowledgePipelineRunCreateManyInput | KnowledgePipelineRunCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * KnowledgePipelineRun update
   */
  export type KnowledgePipelineRunUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgePipelineRun
     */
    select?: KnowledgePipelineRunSelect<ExtArgs> | null
    /**
     * The data needed to update a KnowledgePipelineRun.
     */
    data: XOR<KnowledgePipelineRunUpdateInput, KnowledgePipelineRunUncheckedUpdateInput>
    /**
     * Choose, which KnowledgePipelineRun to update.
     */
    where: KnowledgePipelineRunWhereUniqueInput
  }

  /**
   * KnowledgePipelineRun updateMany
   */
  export type KnowledgePipelineRunUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update KnowledgePipelineRuns.
     */
    data: XOR<KnowledgePipelineRunUpdateManyMutationInput, KnowledgePipelineRunUncheckedUpdateManyInput>
    /**
     * Filter which KnowledgePipelineRuns to update
     */
    where?: KnowledgePipelineRunWhereInput
  }

  /**
   * KnowledgePipelineRun upsert
   */
  export type KnowledgePipelineRunUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgePipelineRun
     */
    select?: KnowledgePipelineRunSelect<ExtArgs> | null
    /**
     * The filter to search for the KnowledgePipelineRun to update in case it exists.
     */
    where: KnowledgePipelineRunWhereUniqueInput
    /**
     * In case the KnowledgePipelineRun found by the `where` argument doesn't exist, create a new KnowledgePipelineRun with this data.
     */
    create: XOR<KnowledgePipelineRunCreateInput, KnowledgePipelineRunUncheckedCreateInput>
    /**
     * In case the KnowledgePipelineRun was found with the provided `where` argument, update it with this data.
     */
    update: XOR<KnowledgePipelineRunUpdateInput, KnowledgePipelineRunUncheckedUpdateInput>
  }

  /**
   * KnowledgePipelineRun delete
   */
  export type KnowledgePipelineRunDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgePipelineRun
     */
    select?: KnowledgePipelineRunSelect<ExtArgs> | null
    /**
     * Filter which KnowledgePipelineRun to delete.
     */
    where: KnowledgePipelineRunWhereUniqueInput
  }

  /**
   * KnowledgePipelineRun deleteMany
   */
  export type KnowledgePipelineRunDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which KnowledgePipelineRuns to delete
     */
    where?: KnowledgePipelineRunWhereInput
  }

  /**
   * KnowledgePipelineRun without action
   */
  export type KnowledgePipelineRunDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgePipelineRun
     */
    select?: KnowledgePipelineRunSelect<ExtArgs> | null
  }


  /**
   * Model KnowledgeReviewItem
   */

  export type AggregateKnowledgeReviewItem = {
    _count: KnowledgeReviewItemCountAggregateOutputType | null
    _min: KnowledgeReviewItemMinAggregateOutputType | null
    _max: KnowledgeReviewItemMaxAggregateOutputType | null
  }

  export type KnowledgeReviewItemMinAggregateOutputType = {
    id: string | null
    documentId: string | null
    reason: string | null
    status: $Enums.KnowledgeReviewStatus | null
    reviewedBy: string | null
    reviewedAt: Date | null
  }

  export type KnowledgeReviewItemMaxAggregateOutputType = {
    id: string | null
    documentId: string | null
    reason: string | null
    status: $Enums.KnowledgeReviewStatus | null
    reviewedBy: string | null
    reviewedAt: Date | null
  }

  export type KnowledgeReviewItemCountAggregateOutputType = {
    id: number
    documentId: number
    reason: number
    status: number
    reviewedBy: number
    reviewedAt: number
    _all: number
  }


  export type KnowledgeReviewItemMinAggregateInputType = {
    id?: true
    documentId?: true
    reason?: true
    status?: true
    reviewedBy?: true
    reviewedAt?: true
  }

  export type KnowledgeReviewItemMaxAggregateInputType = {
    id?: true
    documentId?: true
    reason?: true
    status?: true
    reviewedBy?: true
    reviewedAt?: true
  }

  export type KnowledgeReviewItemCountAggregateInputType = {
    id?: true
    documentId?: true
    reason?: true
    status?: true
    reviewedBy?: true
    reviewedAt?: true
    _all?: true
  }

  export type KnowledgeReviewItemAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which KnowledgeReviewItem to aggregate.
     */
    where?: KnowledgeReviewItemWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of KnowledgeReviewItems to fetch.
     */
    orderBy?: KnowledgeReviewItemOrderByWithRelationInput | KnowledgeReviewItemOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: KnowledgeReviewItemWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` KnowledgeReviewItems from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` KnowledgeReviewItems.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned KnowledgeReviewItems
    **/
    _count?: true | KnowledgeReviewItemCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: KnowledgeReviewItemMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: KnowledgeReviewItemMaxAggregateInputType
  }

  export type GetKnowledgeReviewItemAggregateType<T extends KnowledgeReviewItemAggregateArgs> = {
        [P in keyof T & keyof AggregateKnowledgeReviewItem]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateKnowledgeReviewItem[P]>
      : GetScalarType<T[P], AggregateKnowledgeReviewItem[P]>
  }




  export type KnowledgeReviewItemGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: KnowledgeReviewItemWhereInput
    orderBy?: KnowledgeReviewItemOrderByWithAggregationInput | KnowledgeReviewItemOrderByWithAggregationInput[]
    by: KnowledgeReviewItemScalarFieldEnum[] | KnowledgeReviewItemScalarFieldEnum
    having?: KnowledgeReviewItemScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: KnowledgeReviewItemCountAggregateInputType | true
    _min?: KnowledgeReviewItemMinAggregateInputType
    _max?: KnowledgeReviewItemMaxAggregateInputType
  }

  export type KnowledgeReviewItemGroupByOutputType = {
    id: string
    documentId: string
    reason: string | null
    status: $Enums.KnowledgeReviewStatus
    reviewedBy: string | null
    reviewedAt: Date | null
    _count: KnowledgeReviewItemCountAggregateOutputType | null
    _min: KnowledgeReviewItemMinAggregateOutputType | null
    _max: KnowledgeReviewItemMaxAggregateOutputType | null
  }

  type GetKnowledgeReviewItemGroupByPayload<T extends KnowledgeReviewItemGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<KnowledgeReviewItemGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof KnowledgeReviewItemGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], KnowledgeReviewItemGroupByOutputType[P]>
            : GetScalarType<T[P], KnowledgeReviewItemGroupByOutputType[P]>
        }
      >
    >


  export type KnowledgeReviewItemSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    documentId?: boolean
    reason?: boolean
    status?: boolean
    reviewedBy?: boolean
    reviewedAt?: boolean
    document?: boolean | KnowledgeDocumentDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["knowledgeReviewItem"]>

  export type KnowledgeReviewItemSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    documentId?: boolean
    reason?: boolean
    status?: boolean
    reviewedBy?: boolean
    reviewedAt?: boolean
    document?: boolean | KnowledgeDocumentDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["knowledgeReviewItem"]>

  export type KnowledgeReviewItemSelectScalar = {
    id?: boolean
    documentId?: boolean
    reason?: boolean
    status?: boolean
    reviewedBy?: boolean
    reviewedAt?: boolean
  }

  export type KnowledgeReviewItemInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    document?: boolean | KnowledgeDocumentDefaultArgs<ExtArgs>
  }
  export type KnowledgeReviewItemIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    document?: boolean | KnowledgeDocumentDefaultArgs<ExtArgs>
  }

  export type $KnowledgeReviewItemPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "KnowledgeReviewItem"
    objects: {
      document: Prisma.$KnowledgeDocumentPayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      documentId: string
      reason: string | null
      status: $Enums.KnowledgeReviewStatus
      reviewedBy: string | null
      reviewedAt: Date | null
    }, ExtArgs["result"]["knowledgeReviewItem"]>
    composites: {}
  }

  type KnowledgeReviewItemGetPayload<S extends boolean | null | undefined | KnowledgeReviewItemDefaultArgs> = $Result.GetResult<Prisma.$KnowledgeReviewItemPayload, S>

  type KnowledgeReviewItemCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<KnowledgeReviewItemFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: KnowledgeReviewItemCountAggregateInputType | true
    }

  export interface KnowledgeReviewItemDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['KnowledgeReviewItem'], meta: { name: 'KnowledgeReviewItem' } }
    /**
     * Find zero or one KnowledgeReviewItem that matches the filter.
     * @param {KnowledgeReviewItemFindUniqueArgs} args - Arguments to find a KnowledgeReviewItem
     * @example
     * // Get one KnowledgeReviewItem
     * const knowledgeReviewItem = await prisma.knowledgeReviewItem.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends KnowledgeReviewItemFindUniqueArgs>(args: SelectSubset<T, KnowledgeReviewItemFindUniqueArgs<ExtArgs>>): Prisma__KnowledgeReviewItemClient<$Result.GetResult<Prisma.$KnowledgeReviewItemPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one KnowledgeReviewItem that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {KnowledgeReviewItemFindUniqueOrThrowArgs} args - Arguments to find a KnowledgeReviewItem
     * @example
     * // Get one KnowledgeReviewItem
     * const knowledgeReviewItem = await prisma.knowledgeReviewItem.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends KnowledgeReviewItemFindUniqueOrThrowArgs>(args: SelectSubset<T, KnowledgeReviewItemFindUniqueOrThrowArgs<ExtArgs>>): Prisma__KnowledgeReviewItemClient<$Result.GetResult<Prisma.$KnowledgeReviewItemPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first KnowledgeReviewItem that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {KnowledgeReviewItemFindFirstArgs} args - Arguments to find a KnowledgeReviewItem
     * @example
     * // Get one KnowledgeReviewItem
     * const knowledgeReviewItem = await prisma.knowledgeReviewItem.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends KnowledgeReviewItemFindFirstArgs>(args?: SelectSubset<T, KnowledgeReviewItemFindFirstArgs<ExtArgs>>): Prisma__KnowledgeReviewItemClient<$Result.GetResult<Prisma.$KnowledgeReviewItemPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first KnowledgeReviewItem that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {KnowledgeReviewItemFindFirstOrThrowArgs} args - Arguments to find a KnowledgeReviewItem
     * @example
     * // Get one KnowledgeReviewItem
     * const knowledgeReviewItem = await prisma.knowledgeReviewItem.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends KnowledgeReviewItemFindFirstOrThrowArgs>(args?: SelectSubset<T, KnowledgeReviewItemFindFirstOrThrowArgs<ExtArgs>>): Prisma__KnowledgeReviewItemClient<$Result.GetResult<Prisma.$KnowledgeReviewItemPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more KnowledgeReviewItems that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {KnowledgeReviewItemFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all KnowledgeReviewItems
     * const knowledgeReviewItems = await prisma.knowledgeReviewItem.findMany()
     * 
     * // Get first 10 KnowledgeReviewItems
     * const knowledgeReviewItems = await prisma.knowledgeReviewItem.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const knowledgeReviewItemWithIdOnly = await prisma.knowledgeReviewItem.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends KnowledgeReviewItemFindManyArgs>(args?: SelectSubset<T, KnowledgeReviewItemFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$KnowledgeReviewItemPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a KnowledgeReviewItem.
     * @param {KnowledgeReviewItemCreateArgs} args - Arguments to create a KnowledgeReviewItem.
     * @example
     * // Create one KnowledgeReviewItem
     * const KnowledgeReviewItem = await prisma.knowledgeReviewItem.create({
     *   data: {
     *     // ... data to create a KnowledgeReviewItem
     *   }
     * })
     * 
     */
    create<T extends KnowledgeReviewItemCreateArgs>(args: SelectSubset<T, KnowledgeReviewItemCreateArgs<ExtArgs>>): Prisma__KnowledgeReviewItemClient<$Result.GetResult<Prisma.$KnowledgeReviewItemPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many KnowledgeReviewItems.
     * @param {KnowledgeReviewItemCreateManyArgs} args - Arguments to create many KnowledgeReviewItems.
     * @example
     * // Create many KnowledgeReviewItems
     * const knowledgeReviewItem = await prisma.knowledgeReviewItem.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends KnowledgeReviewItemCreateManyArgs>(args?: SelectSubset<T, KnowledgeReviewItemCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many KnowledgeReviewItems and returns the data saved in the database.
     * @param {KnowledgeReviewItemCreateManyAndReturnArgs} args - Arguments to create many KnowledgeReviewItems.
     * @example
     * // Create many KnowledgeReviewItems
     * const knowledgeReviewItem = await prisma.knowledgeReviewItem.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many KnowledgeReviewItems and only return the `id`
     * const knowledgeReviewItemWithIdOnly = await prisma.knowledgeReviewItem.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends KnowledgeReviewItemCreateManyAndReturnArgs>(args?: SelectSubset<T, KnowledgeReviewItemCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$KnowledgeReviewItemPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a KnowledgeReviewItem.
     * @param {KnowledgeReviewItemDeleteArgs} args - Arguments to delete one KnowledgeReviewItem.
     * @example
     * // Delete one KnowledgeReviewItem
     * const KnowledgeReviewItem = await prisma.knowledgeReviewItem.delete({
     *   where: {
     *     // ... filter to delete one KnowledgeReviewItem
     *   }
     * })
     * 
     */
    delete<T extends KnowledgeReviewItemDeleteArgs>(args: SelectSubset<T, KnowledgeReviewItemDeleteArgs<ExtArgs>>): Prisma__KnowledgeReviewItemClient<$Result.GetResult<Prisma.$KnowledgeReviewItemPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one KnowledgeReviewItem.
     * @param {KnowledgeReviewItemUpdateArgs} args - Arguments to update one KnowledgeReviewItem.
     * @example
     * // Update one KnowledgeReviewItem
     * const knowledgeReviewItem = await prisma.knowledgeReviewItem.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends KnowledgeReviewItemUpdateArgs>(args: SelectSubset<T, KnowledgeReviewItemUpdateArgs<ExtArgs>>): Prisma__KnowledgeReviewItemClient<$Result.GetResult<Prisma.$KnowledgeReviewItemPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more KnowledgeReviewItems.
     * @param {KnowledgeReviewItemDeleteManyArgs} args - Arguments to filter KnowledgeReviewItems to delete.
     * @example
     * // Delete a few KnowledgeReviewItems
     * const { count } = await prisma.knowledgeReviewItem.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends KnowledgeReviewItemDeleteManyArgs>(args?: SelectSubset<T, KnowledgeReviewItemDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more KnowledgeReviewItems.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {KnowledgeReviewItemUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many KnowledgeReviewItems
     * const knowledgeReviewItem = await prisma.knowledgeReviewItem.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends KnowledgeReviewItemUpdateManyArgs>(args: SelectSubset<T, KnowledgeReviewItemUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one KnowledgeReviewItem.
     * @param {KnowledgeReviewItemUpsertArgs} args - Arguments to update or create a KnowledgeReviewItem.
     * @example
     * // Update or create a KnowledgeReviewItem
     * const knowledgeReviewItem = await prisma.knowledgeReviewItem.upsert({
     *   create: {
     *     // ... data to create a KnowledgeReviewItem
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the KnowledgeReviewItem we want to update
     *   }
     * })
     */
    upsert<T extends KnowledgeReviewItemUpsertArgs>(args: SelectSubset<T, KnowledgeReviewItemUpsertArgs<ExtArgs>>): Prisma__KnowledgeReviewItemClient<$Result.GetResult<Prisma.$KnowledgeReviewItemPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of KnowledgeReviewItems.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {KnowledgeReviewItemCountArgs} args - Arguments to filter KnowledgeReviewItems to count.
     * @example
     * // Count the number of KnowledgeReviewItems
     * const count = await prisma.knowledgeReviewItem.count({
     *   where: {
     *     // ... the filter for the KnowledgeReviewItems we want to count
     *   }
     * })
    **/
    count<T extends KnowledgeReviewItemCountArgs>(
      args?: Subset<T, KnowledgeReviewItemCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], KnowledgeReviewItemCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a KnowledgeReviewItem.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {KnowledgeReviewItemAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends KnowledgeReviewItemAggregateArgs>(args: Subset<T, KnowledgeReviewItemAggregateArgs>): Prisma.PrismaPromise<GetKnowledgeReviewItemAggregateType<T>>

    /**
     * Group by KnowledgeReviewItem.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {KnowledgeReviewItemGroupByArgs} args - Group by arguments.
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
      T extends KnowledgeReviewItemGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: KnowledgeReviewItemGroupByArgs['orderBy'] }
        : { orderBy?: KnowledgeReviewItemGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, KnowledgeReviewItemGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetKnowledgeReviewItemGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the KnowledgeReviewItem model
   */
  readonly fields: KnowledgeReviewItemFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for KnowledgeReviewItem.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__KnowledgeReviewItemClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    document<T extends KnowledgeDocumentDefaultArgs<ExtArgs> = {}>(args?: Subset<T, KnowledgeDocumentDefaultArgs<ExtArgs>>): Prisma__KnowledgeDocumentClient<$Result.GetResult<Prisma.$KnowledgeDocumentPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
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
   * Fields of the KnowledgeReviewItem model
   */ 
  interface KnowledgeReviewItemFieldRefs {
    readonly id: FieldRef<"KnowledgeReviewItem", 'String'>
    readonly documentId: FieldRef<"KnowledgeReviewItem", 'String'>
    readonly reason: FieldRef<"KnowledgeReviewItem", 'String'>
    readonly status: FieldRef<"KnowledgeReviewItem", 'KnowledgeReviewStatus'>
    readonly reviewedBy: FieldRef<"KnowledgeReviewItem", 'String'>
    readonly reviewedAt: FieldRef<"KnowledgeReviewItem", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * KnowledgeReviewItem findUnique
   */
  export type KnowledgeReviewItemFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeReviewItem
     */
    select?: KnowledgeReviewItemSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeReviewItemInclude<ExtArgs> | null
    /**
     * Filter, which KnowledgeReviewItem to fetch.
     */
    where: KnowledgeReviewItemWhereUniqueInput
  }

  /**
   * KnowledgeReviewItem findUniqueOrThrow
   */
  export type KnowledgeReviewItemFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeReviewItem
     */
    select?: KnowledgeReviewItemSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeReviewItemInclude<ExtArgs> | null
    /**
     * Filter, which KnowledgeReviewItem to fetch.
     */
    where: KnowledgeReviewItemWhereUniqueInput
  }

  /**
   * KnowledgeReviewItem findFirst
   */
  export type KnowledgeReviewItemFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeReviewItem
     */
    select?: KnowledgeReviewItemSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeReviewItemInclude<ExtArgs> | null
    /**
     * Filter, which KnowledgeReviewItem to fetch.
     */
    where?: KnowledgeReviewItemWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of KnowledgeReviewItems to fetch.
     */
    orderBy?: KnowledgeReviewItemOrderByWithRelationInput | KnowledgeReviewItemOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for KnowledgeReviewItems.
     */
    cursor?: KnowledgeReviewItemWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` KnowledgeReviewItems from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` KnowledgeReviewItems.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of KnowledgeReviewItems.
     */
    distinct?: KnowledgeReviewItemScalarFieldEnum | KnowledgeReviewItemScalarFieldEnum[]
  }

  /**
   * KnowledgeReviewItem findFirstOrThrow
   */
  export type KnowledgeReviewItemFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeReviewItem
     */
    select?: KnowledgeReviewItemSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeReviewItemInclude<ExtArgs> | null
    /**
     * Filter, which KnowledgeReviewItem to fetch.
     */
    where?: KnowledgeReviewItemWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of KnowledgeReviewItems to fetch.
     */
    orderBy?: KnowledgeReviewItemOrderByWithRelationInput | KnowledgeReviewItemOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for KnowledgeReviewItems.
     */
    cursor?: KnowledgeReviewItemWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` KnowledgeReviewItems from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` KnowledgeReviewItems.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of KnowledgeReviewItems.
     */
    distinct?: KnowledgeReviewItemScalarFieldEnum | KnowledgeReviewItemScalarFieldEnum[]
  }

  /**
   * KnowledgeReviewItem findMany
   */
  export type KnowledgeReviewItemFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeReviewItem
     */
    select?: KnowledgeReviewItemSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeReviewItemInclude<ExtArgs> | null
    /**
     * Filter, which KnowledgeReviewItems to fetch.
     */
    where?: KnowledgeReviewItemWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of KnowledgeReviewItems to fetch.
     */
    orderBy?: KnowledgeReviewItemOrderByWithRelationInput | KnowledgeReviewItemOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing KnowledgeReviewItems.
     */
    cursor?: KnowledgeReviewItemWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` KnowledgeReviewItems from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` KnowledgeReviewItems.
     */
    skip?: number
    distinct?: KnowledgeReviewItemScalarFieldEnum | KnowledgeReviewItemScalarFieldEnum[]
  }

  /**
   * KnowledgeReviewItem create
   */
  export type KnowledgeReviewItemCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeReviewItem
     */
    select?: KnowledgeReviewItemSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeReviewItemInclude<ExtArgs> | null
    /**
     * The data needed to create a KnowledgeReviewItem.
     */
    data: XOR<KnowledgeReviewItemCreateInput, KnowledgeReviewItemUncheckedCreateInput>
  }

  /**
   * KnowledgeReviewItem createMany
   */
  export type KnowledgeReviewItemCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many KnowledgeReviewItems.
     */
    data: KnowledgeReviewItemCreateManyInput | KnowledgeReviewItemCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * KnowledgeReviewItem createManyAndReturn
   */
  export type KnowledgeReviewItemCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeReviewItem
     */
    select?: KnowledgeReviewItemSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many KnowledgeReviewItems.
     */
    data: KnowledgeReviewItemCreateManyInput | KnowledgeReviewItemCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeReviewItemIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * KnowledgeReviewItem update
   */
  export type KnowledgeReviewItemUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeReviewItem
     */
    select?: KnowledgeReviewItemSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeReviewItemInclude<ExtArgs> | null
    /**
     * The data needed to update a KnowledgeReviewItem.
     */
    data: XOR<KnowledgeReviewItemUpdateInput, KnowledgeReviewItemUncheckedUpdateInput>
    /**
     * Choose, which KnowledgeReviewItem to update.
     */
    where: KnowledgeReviewItemWhereUniqueInput
  }

  /**
   * KnowledgeReviewItem updateMany
   */
  export type KnowledgeReviewItemUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update KnowledgeReviewItems.
     */
    data: XOR<KnowledgeReviewItemUpdateManyMutationInput, KnowledgeReviewItemUncheckedUpdateManyInput>
    /**
     * Filter which KnowledgeReviewItems to update
     */
    where?: KnowledgeReviewItemWhereInput
  }

  /**
   * KnowledgeReviewItem upsert
   */
  export type KnowledgeReviewItemUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeReviewItem
     */
    select?: KnowledgeReviewItemSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeReviewItemInclude<ExtArgs> | null
    /**
     * The filter to search for the KnowledgeReviewItem to update in case it exists.
     */
    where: KnowledgeReviewItemWhereUniqueInput
    /**
     * In case the KnowledgeReviewItem found by the `where` argument doesn't exist, create a new KnowledgeReviewItem with this data.
     */
    create: XOR<KnowledgeReviewItemCreateInput, KnowledgeReviewItemUncheckedCreateInput>
    /**
     * In case the KnowledgeReviewItem was found with the provided `where` argument, update it with this data.
     */
    update: XOR<KnowledgeReviewItemUpdateInput, KnowledgeReviewItemUncheckedUpdateInput>
  }

  /**
   * KnowledgeReviewItem delete
   */
  export type KnowledgeReviewItemDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeReviewItem
     */
    select?: KnowledgeReviewItemSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeReviewItemInclude<ExtArgs> | null
    /**
     * Filter which KnowledgeReviewItem to delete.
     */
    where: KnowledgeReviewItemWhereUniqueInput
  }

  /**
   * KnowledgeReviewItem deleteMany
   */
  export type KnowledgeReviewItemDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which KnowledgeReviewItems to delete
     */
    where?: KnowledgeReviewItemWhereInput
  }

  /**
   * KnowledgeReviewItem without action
   */
  export type KnowledgeReviewItemDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeReviewItem
     */
    select?: KnowledgeReviewItemSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeReviewItemInclude<ExtArgs> | null
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


  export const ConversationScalarFieldEnum: {
    id: 'id',
    userId: 'userId',
    sessionId: 'sessionId',
    question: 'question',
    answer: 'answer',
    modelUsed: 'modelUsed',
    responseTime: 'responseTime',
    relevance: 'relevance',
    relevanceExplanation: 'relevanceExplanation',
    promptTokens: 'promptTokens',
    completionTokens: 'completionTokens',
    totalTokens: 'totalTokens',
    cost: 'cost',
    feedback: 'feedback',
    feedbackTimestamp: 'feedbackTimestamp',
    traceId: 'traceId',
    usedFallback: 'usedFallback',
    usedDeterministicFallback: 'usedDeterministicFallback',
    responseLanguage: 'responseLanguage',
    routeIntent: 'routeIntent',
    warningCount: 'warningCount',
    createdAt: 'createdAt'
  };

  export type ConversationScalarFieldEnum = (typeof ConversationScalarFieldEnum)[keyof typeof ConversationScalarFieldEnum]


  export const ChatSessionScalarFieldEnum: {
    id: 'id',
    userId: 'userId',
    title: 'title',
    lastMessageAt: 'lastMessageAt',
    archivedAt: 'archivedAt',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type ChatSessionScalarFieldEnum = (typeof ChatSessionScalarFieldEnum)[keyof typeof ChatSessionScalarFieldEnum]


  export const UserMemoryScalarFieldEnum: {
    id: 'id',
    userId: 'userId',
    content: 'content',
    category: 'category',
    createdAt: 'createdAt'
  };

  export type UserMemoryScalarFieldEnum = (typeof UserMemoryScalarFieldEnum)[keyof typeof UserMemoryScalarFieldEnum]


  export const WorkoutPlanScalarFieldEnum: {
    id: 'id',
    userId: 'userId',
    name: 'name',
    description: 'description',
    goal: 'goal',
    duration: 'duration',
    daysPerWeek: 'daysPerWeek',
    plan: 'plan',
    status: 'status',
    version: 'version',
    jobId: 'jobId',
    failReason: 'failReason',
    ptUserId: 'ptUserId',
    ptName: 'ptName',
    clientName: 'clientName',
    ptReviewStatus: 'ptReviewStatus',
    ptNote: 'ptNote',
    ptReviewedAt: 'ptReviewedAt',
    archivedAt: 'archivedAt',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type WorkoutPlanScalarFieldEnum = (typeof WorkoutPlanScalarFieldEnum)[keyof typeof WorkoutPlanScalarFieldEnum]


  export const PublishedPlanScalarFieldEnum: {
    id: 'id',
    sourcePlanId: 'sourcePlanId',
    publisherId: 'publisherId',
    title: 'title',
    description: 'description',
    goal: 'goal',
    moderationStatus: 'moderationStatus',
    moderationNote: 'moderationNote',
    avgRating: 'avgRating',
    ratingCount: 'ratingCount',
    publishedAt: 'publishedAt',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type PublishedPlanScalarFieldEnum = (typeof PublishedPlanScalarFieldEnum)[keyof typeof PublishedPlanScalarFieldEnum]


  export const PlanReviewScalarFieldEnum: {
    id: 'id',
    publishedPlanId: 'publishedPlanId',
    reviewerId: 'reviewerId',
    rating: 'rating',
    comment: 'comment',
    createdAt: 'createdAt'
  };

  export type PlanReviewScalarFieldEnum = (typeof PlanReviewScalarFieldEnum)[keyof typeof PlanReviewScalarFieldEnum]


  export const TrainingPackageScalarFieldEnum: {
    id: 'id',
    sellerId: 'sellerId',
    publishedPlanId: 'publishedPlanId',
    name: 'name',
    description: 'description',
    price: 'price',
    durationWeeks: 'durationWeeks',
    status: 'status',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type TrainingPackageScalarFieldEnum = (typeof TrainingPackageScalarFieldEnum)[keyof typeof TrainingPackageScalarFieldEnum]


  export const TrainingPackagePurchaseScalarFieldEnum: {
    id: 'id',
    packageId: 'packageId',
    buyerId: 'buyerId',
    priceAtPurchase: 'priceAtPurchase',
    paymentTransactionId: 'paymentTransactionId',
    status: 'status',
    purchasedAt: 'purchasedAt',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type TrainingPackagePurchaseScalarFieldEnum = (typeof TrainingPackagePurchaseScalarFieldEnum)[keyof typeof TrainingPackagePurchaseScalarFieldEnum]


  export const NutritionPlanScalarFieldEnum: {
    id: 'id',
    userId: 'userId',
    name: 'name',
    goal: 'goal',
    durationWeeks: 'durationWeeks',
    mealsPerDay: 'mealsPerDay',
    plan: 'plan',
    status: 'status',
    jobId: 'jobId',
    failReason: 'failReason',
    archivedAt: 'archivedAt',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type NutritionPlanScalarFieldEnum = (typeof NutritionPlanScalarFieldEnum)[keyof typeof NutritionPlanScalarFieldEnum]


  export const KnowledgeSourceScalarFieldEnum: {
    id: 'id',
    name: 'name',
    baseUrl: 'baseUrl',
    sourceType: 'sourceType',
    trustTier: 'trustTier',
    crawlCron: 'crawlCron',
    isActive: 'isActive',
    lastCrawledAt: 'lastCrawledAt',
    createdAt: 'createdAt'
  };

  export type KnowledgeSourceScalarFieldEnum = (typeof KnowledgeSourceScalarFieldEnum)[keyof typeof KnowledgeSourceScalarFieldEnum]


  export const KnowledgeDocumentScalarFieldEnum: {
    id: 'id',
    sourceId: 'sourceId',
    url: 'url',
    title: 'title',
    author: 'author',
    language: 'language',
    contentHash: 'contentHash',
    rawObjectKey: 'rawObjectKey',
    cleanText: 'cleanText',
    topic: 'topic',
    trustScore: 'trustScore',
    qualityScore: 'qualityScore',
    safetyFlag: 'safetyFlag',
    status: 'status',
    rejectionReason: 'rejectionReason',
    publishedAt: 'publishedAt',
    crawledAt: 'crawledAt',
    processedAt: 'processedAt'
  };

  export type KnowledgeDocumentScalarFieldEnum = (typeof KnowledgeDocumentScalarFieldEnum)[keyof typeof KnowledgeDocumentScalarFieldEnum]


  export const KnowledgeChunkScalarFieldEnum: {
    id: 'id',
    documentId: 'documentId',
    chunkIndex: 'chunkIndex',
    text: 'text',
    tokenCount: 'tokenCount',
    vectorId: 'vectorId',
    embeddedAt: 'embeddedAt'
  };

  export type KnowledgeChunkScalarFieldEnum = (typeof KnowledgeChunkScalarFieldEnum)[keyof typeof KnowledgeChunkScalarFieldEnum]


  export const KnowledgePipelineRunScalarFieldEnum: {
    id: 'id',
    runType: 'runType',
    startedAt: 'startedAt',
    finishedAt: 'finishedAt',
    docsCrawled: 'docsCrawled',
    docsAccepted: 'docsAccepted',
    docsRejected: 'docsRejected',
    docsReview: 'docsReview',
    status: 'status'
  };

  export type KnowledgePipelineRunScalarFieldEnum = (typeof KnowledgePipelineRunScalarFieldEnum)[keyof typeof KnowledgePipelineRunScalarFieldEnum]


  export const KnowledgeReviewItemScalarFieldEnum: {
    id: 'id',
    documentId: 'documentId',
    reason: 'reason',
    status: 'status',
    reviewedBy: 'reviewedBy',
    reviewedAt: 'reviewedAt'
  };

  export type KnowledgeReviewItemScalarFieldEnum = (typeof KnowledgeReviewItemScalarFieldEnum)[keyof typeof KnowledgeReviewItemScalarFieldEnum]


  export const SortOrder: {
    asc: 'asc',
    desc: 'desc'
  };

  export type SortOrder = (typeof SortOrder)[keyof typeof SortOrder]


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
   * Reference to a field of type 'Float'
   */
  export type FloatFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Float'>
    


  /**
   * Reference to a field of type 'Float[]'
   */
  export type ListFloatFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Float[]'>
    


  /**
   * Reference to a field of type 'Int'
   */
  export type IntFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Int'>
    


  /**
   * Reference to a field of type 'Int[]'
   */
  export type ListIntFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Int[]'>
    


  /**
   * Reference to a field of type 'DateTime'
   */
  export type DateTimeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'DateTime'>
    


  /**
   * Reference to a field of type 'DateTime[]'
   */
  export type ListDateTimeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'DateTime[]'>
    


  /**
   * Reference to a field of type 'Boolean'
   */
  export type BooleanFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Boolean'>
    


  /**
   * Reference to a field of type 'Json'
   */
  export type JsonFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Json'>
    


  /**
   * Reference to a field of type 'PlanStatus'
   */
  export type EnumPlanStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'PlanStatus'>
    


  /**
   * Reference to a field of type 'PlanStatus[]'
   */
  export type ListEnumPlanStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'PlanStatus[]'>
    


  /**
   * Reference to a field of type 'PtReviewStatus'
   */
  export type EnumPtReviewStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'PtReviewStatus'>
    


  /**
   * Reference to a field of type 'PtReviewStatus[]'
   */
  export type ListEnumPtReviewStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'PtReviewStatus[]'>
    


  /**
   * Reference to a field of type 'PublishModerationStatus'
   */
  export type EnumPublishModerationStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'PublishModerationStatus'>
    


  /**
   * Reference to a field of type 'PublishModerationStatus[]'
   */
  export type ListEnumPublishModerationStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'PublishModerationStatus[]'>
    


  /**
   * Reference to a field of type 'TrainingPackageStatus'
   */
  export type EnumTrainingPackageStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'TrainingPackageStatus'>
    


  /**
   * Reference to a field of type 'TrainingPackageStatus[]'
   */
  export type ListEnumTrainingPackageStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'TrainingPackageStatus[]'>
    


  /**
   * Reference to a field of type 'TrainingPackagePurchaseStatus'
   */
  export type EnumTrainingPackagePurchaseStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'TrainingPackagePurchaseStatus'>
    


  /**
   * Reference to a field of type 'TrainingPackagePurchaseStatus[]'
   */
  export type ListEnumTrainingPackagePurchaseStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'TrainingPackagePurchaseStatus[]'>
    


  /**
   * Reference to a field of type 'KnowledgeSourceType'
   */
  export type EnumKnowledgeSourceTypeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'KnowledgeSourceType'>
    


  /**
   * Reference to a field of type 'KnowledgeSourceType[]'
   */
  export type ListEnumKnowledgeSourceTypeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'KnowledgeSourceType[]'>
    


  /**
   * Reference to a field of type 'KnowledgeDocumentTopic'
   */
  export type EnumKnowledgeDocumentTopicFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'KnowledgeDocumentTopic'>
    


  /**
   * Reference to a field of type 'KnowledgeDocumentTopic[]'
   */
  export type ListEnumKnowledgeDocumentTopicFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'KnowledgeDocumentTopic[]'>
    


  /**
   * Reference to a field of type 'Decimal'
   */
  export type DecimalFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Decimal'>
    


  /**
   * Reference to a field of type 'Decimal[]'
   */
  export type ListDecimalFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Decimal[]'>
    


  /**
   * Reference to a field of type 'KnowledgeDocumentStatus'
   */
  export type EnumKnowledgeDocumentStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'KnowledgeDocumentStatus'>
    


  /**
   * Reference to a field of type 'KnowledgeDocumentStatus[]'
   */
  export type ListEnumKnowledgeDocumentStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'KnowledgeDocumentStatus[]'>
    


  /**
   * Reference to a field of type 'KnowledgePipelineRunStatus'
   */
  export type EnumKnowledgePipelineRunStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'KnowledgePipelineRunStatus'>
    


  /**
   * Reference to a field of type 'KnowledgePipelineRunStatus[]'
   */
  export type ListEnumKnowledgePipelineRunStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'KnowledgePipelineRunStatus[]'>
    


  /**
   * Reference to a field of type 'KnowledgeReviewStatus'
   */
  export type EnumKnowledgeReviewStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'KnowledgeReviewStatus'>
    


  /**
   * Reference to a field of type 'KnowledgeReviewStatus[]'
   */
  export type ListEnumKnowledgeReviewStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'KnowledgeReviewStatus[]'>
    
  /**
   * Deep Input Types
   */


  export type ConversationWhereInput = {
    AND?: ConversationWhereInput | ConversationWhereInput[]
    OR?: ConversationWhereInput[]
    NOT?: ConversationWhereInput | ConversationWhereInput[]
    id?: StringFilter<"Conversation"> | string
    userId?: StringNullableFilter<"Conversation"> | string | null
    sessionId?: StringNullableFilter<"Conversation"> | string | null
    question?: StringFilter<"Conversation"> | string
    answer?: StringFilter<"Conversation"> | string
    modelUsed?: StringFilter<"Conversation"> | string
    responseTime?: FloatFilter<"Conversation"> | number
    relevance?: StringNullableFilter<"Conversation"> | string | null
    relevanceExplanation?: StringNullableFilter<"Conversation"> | string | null
    promptTokens?: IntFilter<"Conversation"> | number
    completionTokens?: IntFilter<"Conversation"> | number
    totalTokens?: IntFilter<"Conversation"> | number
    cost?: FloatFilter<"Conversation"> | number
    feedback?: IntNullableFilter<"Conversation"> | number | null
    feedbackTimestamp?: DateTimeNullableFilter<"Conversation"> | Date | string | null
    traceId?: StringNullableFilter<"Conversation"> | string | null
    usedFallback?: BoolFilter<"Conversation"> | boolean
    usedDeterministicFallback?: BoolFilter<"Conversation"> | boolean
    responseLanguage?: StringNullableFilter<"Conversation"> | string | null
    routeIntent?: StringNullableFilter<"Conversation"> | string | null
    warningCount?: IntFilter<"Conversation"> | number
    createdAt?: DateTimeFilter<"Conversation"> | Date | string
  }

  export type ConversationOrderByWithRelationInput = {
    id?: SortOrder
    userId?: SortOrderInput | SortOrder
    sessionId?: SortOrderInput | SortOrder
    question?: SortOrder
    answer?: SortOrder
    modelUsed?: SortOrder
    responseTime?: SortOrder
    relevance?: SortOrderInput | SortOrder
    relevanceExplanation?: SortOrderInput | SortOrder
    promptTokens?: SortOrder
    completionTokens?: SortOrder
    totalTokens?: SortOrder
    cost?: SortOrder
    feedback?: SortOrderInput | SortOrder
    feedbackTimestamp?: SortOrderInput | SortOrder
    traceId?: SortOrderInput | SortOrder
    usedFallback?: SortOrder
    usedDeterministicFallback?: SortOrder
    responseLanguage?: SortOrderInput | SortOrder
    routeIntent?: SortOrderInput | SortOrder
    warningCount?: SortOrder
    createdAt?: SortOrder
  }

  export type ConversationWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: ConversationWhereInput | ConversationWhereInput[]
    OR?: ConversationWhereInput[]
    NOT?: ConversationWhereInput | ConversationWhereInput[]
    userId?: StringNullableFilter<"Conversation"> | string | null
    sessionId?: StringNullableFilter<"Conversation"> | string | null
    question?: StringFilter<"Conversation"> | string
    answer?: StringFilter<"Conversation"> | string
    modelUsed?: StringFilter<"Conversation"> | string
    responseTime?: FloatFilter<"Conversation"> | number
    relevance?: StringNullableFilter<"Conversation"> | string | null
    relevanceExplanation?: StringNullableFilter<"Conversation"> | string | null
    promptTokens?: IntFilter<"Conversation"> | number
    completionTokens?: IntFilter<"Conversation"> | number
    totalTokens?: IntFilter<"Conversation"> | number
    cost?: FloatFilter<"Conversation"> | number
    feedback?: IntNullableFilter<"Conversation"> | number | null
    feedbackTimestamp?: DateTimeNullableFilter<"Conversation"> | Date | string | null
    traceId?: StringNullableFilter<"Conversation"> | string | null
    usedFallback?: BoolFilter<"Conversation"> | boolean
    usedDeterministicFallback?: BoolFilter<"Conversation"> | boolean
    responseLanguage?: StringNullableFilter<"Conversation"> | string | null
    routeIntent?: StringNullableFilter<"Conversation"> | string | null
    warningCount?: IntFilter<"Conversation"> | number
    createdAt?: DateTimeFilter<"Conversation"> | Date | string
  }, "id">

  export type ConversationOrderByWithAggregationInput = {
    id?: SortOrder
    userId?: SortOrderInput | SortOrder
    sessionId?: SortOrderInput | SortOrder
    question?: SortOrder
    answer?: SortOrder
    modelUsed?: SortOrder
    responseTime?: SortOrder
    relevance?: SortOrderInput | SortOrder
    relevanceExplanation?: SortOrderInput | SortOrder
    promptTokens?: SortOrder
    completionTokens?: SortOrder
    totalTokens?: SortOrder
    cost?: SortOrder
    feedback?: SortOrderInput | SortOrder
    feedbackTimestamp?: SortOrderInput | SortOrder
    traceId?: SortOrderInput | SortOrder
    usedFallback?: SortOrder
    usedDeterministicFallback?: SortOrder
    responseLanguage?: SortOrderInput | SortOrder
    routeIntent?: SortOrderInput | SortOrder
    warningCount?: SortOrder
    createdAt?: SortOrder
    _count?: ConversationCountOrderByAggregateInput
    _avg?: ConversationAvgOrderByAggregateInput
    _max?: ConversationMaxOrderByAggregateInput
    _min?: ConversationMinOrderByAggregateInput
    _sum?: ConversationSumOrderByAggregateInput
  }

  export type ConversationScalarWhereWithAggregatesInput = {
    AND?: ConversationScalarWhereWithAggregatesInput | ConversationScalarWhereWithAggregatesInput[]
    OR?: ConversationScalarWhereWithAggregatesInput[]
    NOT?: ConversationScalarWhereWithAggregatesInput | ConversationScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"Conversation"> | string
    userId?: StringNullableWithAggregatesFilter<"Conversation"> | string | null
    sessionId?: StringNullableWithAggregatesFilter<"Conversation"> | string | null
    question?: StringWithAggregatesFilter<"Conversation"> | string
    answer?: StringWithAggregatesFilter<"Conversation"> | string
    modelUsed?: StringWithAggregatesFilter<"Conversation"> | string
    responseTime?: FloatWithAggregatesFilter<"Conversation"> | number
    relevance?: StringNullableWithAggregatesFilter<"Conversation"> | string | null
    relevanceExplanation?: StringNullableWithAggregatesFilter<"Conversation"> | string | null
    promptTokens?: IntWithAggregatesFilter<"Conversation"> | number
    completionTokens?: IntWithAggregatesFilter<"Conversation"> | number
    totalTokens?: IntWithAggregatesFilter<"Conversation"> | number
    cost?: FloatWithAggregatesFilter<"Conversation"> | number
    feedback?: IntNullableWithAggregatesFilter<"Conversation"> | number | null
    feedbackTimestamp?: DateTimeNullableWithAggregatesFilter<"Conversation"> | Date | string | null
    traceId?: StringNullableWithAggregatesFilter<"Conversation"> | string | null
    usedFallback?: BoolWithAggregatesFilter<"Conversation"> | boolean
    usedDeterministicFallback?: BoolWithAggregatesFilter<"Conversation"> | boolean
    responseLanguage?: StringNullableWithAggregatesFilter<"Conversation"> | string | null
    routeIntent?: StringNullableWithAggregatesFilter<"Conversation"> | string | null
    warningCount?: IntWithAggregatesFilter<"Conversation"> | number
    createdAt?: DateTimeWithAggregatesFilter<"Conversation"> | Date | string
  }

  export type ChatSessionWhereInput = {
    AND?: ChatSessionWhereInput | ChatSessionWhereInput[]
    OR?: ChatSessionWhereInput[]
    NOT?: ChatSessionWhereInput | ChatSessionWhereInput[]
    id?: StringFilter<"ChatSession"> | string
    userId?: StringFilter<"ChatSession"> | string
    title?: StringFilter<"ChatSession"> | string
    lastMessageAt?: DateTimeFilter<"ChatSession"> | Date | string
    archivedAt?: DateTimeNullableFilter<"ChatSession"> | Date | string | null
    createdAt?: DateTimeFilter<"ChatSession"> | Date | string
    updatedAt?: DateTimeFilter<"ChatSession"> | Date | string
  }

  export type ChatSessionOrderByWithRelationInput = {
    id?: SortOrder
    userId?: SortOrder
    title?: SortOrder
    lastMessageAt?: SortOrder
    archivedAt?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type ChatSessionWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: ChatSessionWhereInput | ChatSessionWhereInput[]
    OR?: ChatSessionWhereInput[]
    NOT?: ChatSessionWhereInput | ChatSessionWhereInput[]
    userId?: StringFilter<"ChatSession"> | string
    title?: StringFilter<"ChatSession"> | string
    lastMessageAt?: DateTimeFilter<"ChatSession"> | Date | string
    archivedAt?: DateTimeNullableFilter<"ChatSession"> | Date | string | null
    createdAt?: DateTimeFilter<"ChatSession"> | Date | string
    updatedAt?: DateTimeFilter<"ChatSession"> | Date | string
  }, "id">

  export type ChatSessionOrderByWithAggregationInput = {
    id?: SortOrder
    userId?: SortOrder
    title?: SortOrder
    lastMessageAt?: SortOrder
    archivedAt?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: ChatSessionCountOrderByAggregateInput
    _max?: ChatSessionMaxOrderByAggregateInput
    _min?: ChatSessionMinOrderByAggregateInput
  }

  export type ChatSessionScalarWhereWithAggregatesInput = {
    AND?: ChatSessionScalarWhereWithAggregatesInput | ChatSessionScalarWhereWithAggregatesInput[]
    OR?: ChatSessionScalarWhereWithAggregatesInput[]
    NOT?: ChatSessionScalarWhereWithAggregatesInput | ChatSessionScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"ChatSession"> | string
    userId?: StringWithAggregatesFilter<"ChatSession"> | string
    title?: StringWithAggregatesFilter<"ChatSession"> | string
    lastMessageAt?: DateTimeWithAggregatesFilter<"ChatSession"> | Date | string
    archivedAt?: DateTimeNullableWithAggregatesFilter<"ChatSession"> | Date | string | null
    createdAt?: DateTimeWithAggregatesFilter<"ChatSession"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"ChatSession"> | Date | string
  }

  export type UserMemoryWhereInput = {
    AND?: UserMemoryWhereInput | UserMemoryWhereInput[]
    OR?: UserMemoryWhereInput[]
    NOT?: UserMemoryWhereInput | UserMemoryWhereInput[]
    id?: StringFilter<"UserMemory"> | string
    userId?: StringFilter<"UserMemory"> | string
    content?: StringFilter<"UserMemory"> | string
    category?: StringNullableFilter<"UserMemory"> | string | null
    createdAt?: DateTimeFilter<"UserMemory"> | Date | string
  }

  export type UserMemoryOrderByWithRelationInput = {
    id?: SortOrder
    userId?: SortOrder
    content?: SortOrder
    category?: SortOrderInput | SortOrder
    createdAt?: SortOrder
  }

  export type UserMemoryWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: UserMemoryWhereInput | UserMemoryWhereInput[]
    OR?: UserMemoryWhereInput[]
    NOT?: UserMemoryWhereInput | UserMemoryWhereInput[]
    userId?: StringFilter<"UserMemory"> | string
    content?: StringFilter<"UserMemory"> | string
    category?: StringNullableFilter<"UserMemory"> | string | null
    createdAt?: DateTimeFilter<"UserMemory"> | Date | string
  }, "id">

  export type UserMemoryOrderByWithAggregationInput = {
    id?: SortOrder
    userId?: SortOrder
    content?: SortOrder
    category?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    _count?: UserMemoryCountOrderByAggregateInput
    _max?: UserMemoryMaxOrderByAggregateInput
    _min?: UserMemoryMinOrderByAggregateInput
  }

  export type UserMemoryScalarWhereWithAggregatesInput = {
    AND?: UserMemoryScalarWhereWithAggregatesInput | UserMemoryScalarWhereWithAggregatesInput[]
    OR?: UserMemoryScalarWhereWithAggregatesInput[]
    NOT?: UserMemoryScalarWhereWithAggregatesInput | UserMemoryScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"UserMemory"> | string
    userId?: StringWithAggregatesFilter<"UserMemory"> | string
    content?: StringWithAggregatesFilter<"UserMemory"> | string
    category?: StringNullableWithAggregatesFilter<"UserMemory"> | string | null
    createdAt?: DateTimeWithAggregatesFilter<"UserMemory"> | Date | string
  }

  export type WorkoutPlanWhereInput = {
    AND?: WorkoutPlanWhereInput | WorkoutPlanWhereInput[]
    OR?: WorkoutPlanWhereInput[]
    NOT?: WorkoutPlanWhereInput | WorkoutPlanWhereInput[]
    id?: StringFilter<"WorkoutPlan"> | string
    userId?: StringFilter<"WorkoutPlan"> | string
    name?: StringFilter<"WorkoutPlan"> | string
    description?: StringNullableFilter<"WorkoutPlan"> | string | null
    goal?: StringFilter<"WorkoutPlan"> | string
    duration?: IntFilter<"WorkoutPlan"> | number
    daysPerWeek?: IntFilter<"WorkoutPlan"> | number
    plan?: JsonFilter<"WorkoutPlan">
    status?: EnumPlanStatusFilter<"WorkoutPlan"> | $Enums.PlanStatus
    version?: IntFilter<"WorkoutPlan"> | number
    jobId?: StringNullableFilter<"WorkoutPlan"> | string | null
    failReason?: StringNullableFilter<"WorkoutPlan"> | string | null
    ptUserId?: StringNullableFilter<"WorkoutPlan"> | string | null
    ptName?: StringNullableFilter<"WorkoutPlan"> | string | null
    clientName?: StringNullableFilter<"WorkoutPlan"> | string | null
    ptReviewStatus?: EnumPtReviewStatusNullableFilter<"WorkoutPlan"> | $Enums.PtReviewStatus | null
    ptNote?: StringNullableFilter<"WorkoutPlan"> | string | null
    ptReviewedAt?: DateTimeNullableFilter<"WorkoutPlan"> | Date | string | null
    archivedAt?: DateTimeNullableFilter<"WorkoutPlan"> | Date | string | null
    createdAt?: DateTimeFilter<"WorkoutPlan"> | Date | string
    updatedAt?: DateTimeFilter<"WorkoutPlan"> | Date | string
    publishedListings?: PublishedPlanListRelationFilter
  }

  export type WorkoutPlanOrderByWithRelationInput = {
    id?: SortOrder
    userId?: SortOrder
    name?: SortOrder
    description?: SortOrderInput | SortOrder
    goal?: SortOrder
    duration?: SortOrder
    daysPerWeek?: SortOrder
    plan?: SortOrder
    status?: SortOrder
    version?: SortOrder
    jobId?: SortOrderInput | SortOrder
    failReason?: SortOrderInput | SortOrder
    ptUserId?: SortOrderInput | SortOrder
    ptName?: SortOrderInput | SortOrder
    clientName?: SortOrderInput | SortOrder
    ptReviewStatus?: SortOrderInput | SortOrder
    ptNote?: SortOrderInput | SortOrder
    ptReviewedAt?: SortOrderInput | SortOrder
    archivedAt?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    publishedListings?: PublishedPlanOrderByRelationAggregateInput
  }

  export type WorkoutPlanWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: WorkoutPlanWhereInput | WorkoutPlanWhereInput[]
    OR?: WorkoutPlanWhereInput[]
    NOT?: WorkoutPlanWhereInput | WorkoutPlanWhereInput[]
    userId?: StringFilter<"WorkoutPlan"> | string
    name?: StringFilter<"WorkoutPlan"> | string
    description?: StringNullableFilter<"WorkoutPlan"> | string | null
    goal?: StringFilter<"WorkoutPlan"> | string
    duration?: IntFilter<"WorkoutPlan"> | number
    daysPerWeek?: IntFilter<"WorkoutPlan"> | number
    plan?: JsonFilter<"WorkoutPlan">
    status?: EnumPlanStatusFilter<"WorkoutPlan"> | $Enums.PlanStatus
    version?: IntFilter<"WorkoutPlan"> | number
    jobId?: StringNullableFilter<"WorkoutPlan"> | string | null
    failReason?: StringNullableFilter<"WorkoutPlan"> | string | null
    ptUserId?: StringNullableFilter<"WorkoutPlan"> | string | null
    ptName?: StringNullableFilter<"WorkoutPlan"> | string | null
    clientName?: StringNullableFilter<"WorkoutPlan"> | string | null
    ptReviewStatus?: EnumPtReviewStatusNullableFilter<"WorkoutPlan"> | $Enums.PtReviewStatus | null
    ptNote?: StringNullableFilter<"WorkoutPlan"> | string | null
    ptReviewedAt?: DateTimeNullableFilter<"WorkoutPlan"> | Date | string | null
    archivedAt?: DateTimeNullableFilter<"WorkoutPlan"> | Date | string | null
    createdAt?: DateTimeFilter<"WorkoutPlan"> | Date | string
    updatedAt?: DateTimeFilter<"WorkoutPlan"> | Date | string
    publishedListings?: PublishedPlanListRelationFilter
  }, "id">

  export type WorkoutPlanOrderByWithAggregationInput = {
    id?: SortOrder
    userId?: SortOrder
    name?: SortOrder
    description?: SortOrderInput | SortOrder
    goal?: SortOrder
    duration?: SortOrder
    daysPerWeek?: SortOrder
    plan?: SortOrder
    status?: SortOrder
    version?: SortOrder
    jobId?: SortOrderInput | SortOrder
    failReason?: SortOrderInput | SortOrder
    ptUserId?: SortOrderInput | SortOrder
    ptName?: SortOrderInput | SortOrder
    clientName?: SortOrderInput | SortOrder
    ptReviewStatus?: SortOrderInput | SortOrder
    ptNote?: SortOrderInput | SortOrder
    ptReviewedAt?: SortOrderInput | SortOrder
    archivedAt?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: WorkoutPlanCountOrderByAggregateInput
    _avg?: WorkoutPlanAvgOrderByAggregateInput
    _max?: WorkoutPlanMaxOrderByAggregateInput
    _min?: WorkoutPlanMinOrderByAggregateInput
    _sum?: WorkoutPlanSumOrderByAggregateInput
  }

  export type WorkoutPlanScalarWhereWithAggregatesInput = {
    AND?: WorkoutPlanScalarWhereWithAggregatesInput | WorkoutPlanScalarWhereWithAggregatesInput[]
    OR?: WorkoutPlanScalarWhereWithAggregatesInput[]
    NOT?: WorkoutPlanScalarWhereWithAggregatesInput | WorkoutPlanScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"WorkoutPlan"> | string
    userId?: StringWithAggregatesFilter<"WorkoutPlan"> | string
    name?: StringWithAggregatesFilter<"WorkoutPlan"> | string
    description?: StringNullableWithAggregatesFilter<"WorkoutPlan"> | string | null
    goal?: StringWithAggregatesFilter<"WorkoutPlan"> | string
    duration?: IntWithAggregatesFilter<"WorkoutPlan"> | number
    daysPerWeek?: IntWithAggregatesFilter<"WorkoutPlan"> | number
    plan?: JsonWithAggregatesFilter<"WorkoutPlan">
    status?: EnumPlanStatusWithAggregatesFilter<"WorkoutPlan"> | $Enums.PlanStatus
    version?: IntWithAggregatesFilter<"WorkoutPlan"> | number
    jobId?: StringNullableWithAggregatesFilter<"WorkoutPlan"> | string | null
    failReason?: StringNullableWithAggregatesFilter<"WorkoutPlan"> | string | null
    ptUserId?: StringNullableWithAggregatesFilter<"WorkoutPlan"> | string | null
    ptName?: StringNullableWithAggregatesFilter<"WorkoutPlan"> | string | null
    clientName?: StringNullableWithAggregatesFilter<"WorkoutPlan"> | string | null
    ptReviewStatus?: EnumPtReviewStatusNullableWithAggregatesFilter<"WorkoutPlan"> | $Enums.PtReviewStatus | null
    ptNote?: StringNullableWithAggregatesFilter<"WorkoutPlan"> | string | null
    ptReviewedAt?: DateTimeNullableWithAggregatesFilter<"WorkoutPlan"> | Date | string | null
    archivedAt?: DateTimeNullableWithAggregatesFilter<"WorkoutPlan"> | Date | string | null
    createdAt?: DateTimeWithAggregatesFilter<"WorkoutPlan"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"WorkoutPlan"> | Date | string
  }

  export type PublishedPlanWhereInput = {
    AND?: PublishedPlanWhereInput | PublishedPlanWhereInput[]
    OR?: PublishedPlanWhereInput[]
    NOT?: PublishedPlanWhereInput | PublishedPlanWhereInput[]
    id?: StringFilter<"PublishedPlan"> | string
    sourcePlanId?: StringFilter<"PublishedPlan"> | string
    publisherId?: StringFilter<"PublishedPlan"> | string
    title?: StringFilter<"PublishedPlan"> | string
    description?: StringNullableFilter<"PublishedPlan"> | string | null
    goal?: StringFilter<"PublishedPlan"> | string
    moderationStatus?: EnumPublishModerationStatusFilter<"PublishedPlan"> | $Enums.PublishModerationStatus
    moderationNote?: StringNullableFilter<"PublishedPlan"> | string | null
    avgRating?: FloatFilter<"PublishedPlan"> | number
    ratingCount?: IntFilter<"PublishedPlan"> | number
    publishedAt?: DateTimeNullableFilter<"PublishedPlan"> | Date | string | null
    createdAt?: DateTimeFilter<"PublishedPlan"> | Date | string
    updatedAt?: DateTimeFilter<"PublishedPlan"> | Date | string
    sourcePlan?: XOR<WorkoutPlanRelationFilter, WorkoutPlanWhereInput>
    reviews?: PlanReviewListRelationFilter
    packages?: TrainingPackageListRelationFilter
  }

  export type PublishedPlanOrderByWithRelationInput = {
    id?: SortOrder
    sourcePlanId?: SortOrder
    publisherId?: SortOrder
    title?: SortOrder
    description?: SortOrderInput | SortOrder
    goal?: SortOrder
    moderationStatus?: SortOrder
    moderationNote?: SortOrderInput | SortOrder
    avgRating?: SortOrder
    ratingCount?: SortOrder
    publishedAt?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    sourcePlan?: WorkoutPlanOrderByWithRelationInput
    reviews?: PlanReviewOrderByRelationAggregateInput
    packages?: TrainingPackageOrderByRelationAggregateInput
  }

  export type PublishedPlanWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: PublishedPlanWhereInput | PublishedPlanWhereInput[]
    OR?: PublishedPlanWhereInput[]
    NOT?: PublishedPlanWhereInput | PublishedPlanWhereInput[]
    sourcePlanId?: StringFilter<"PublishedPlan"> | string
    publisherId?: StringFilter<"PublishedPlan"> | string
    title?: StringFilter<"PublishedPlan"> | string
    description?: StringNullableFilter<"PublishedPlan"> | string | null
    goal?: StringFilter<"PublishedPlan"> | string
    moderationStatus?: EnumPublishModerationStatusFilter<"PublishedPlan"> | $Enums.PublishModerationStatus
    moderationNote?: StringNullableFilter<"PublishedPlan"> | string | null
    avgRating?: FloatFilter<"PublishedPlan"> | number
    ratingCount?: IntFilter<"PublishedPlan"> | number
    publishedAt?: DateTimeNullableFilter<"PublishedPlan"> | Date | string | null
    createdAt?: DateTimeFilter<"PublishedPlan"> | Date | string
    updatedAt?: DateTimeFilter<"PublishedPlan"> | Date | string
    sourcePlan?: XOR<WorkoutPlanRelationFilter, WorkoutPlanWhereInput>
    reviews?: PlanReviewListRelationFilter
    packages?: TrainingPackageListRelationFilter
  }, "id">

  export type PublishedPlanOrderByWithAggregationInput = {
    id?: SortOrder
    sourcePlanId?: SortOrder
    publisherId?: SortOrder
    title?: SortOrder
    description?: SortOrderInput | SortOrder
    goal?: SortOrder
    moderationStatus?: SortOrder
    moderationNote?: SortOrderInput | SortOrder
    avgRating?: SortOrder
    ratingCount?: SortOrder
    publishedAt?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: PublishedPlanCountOrderByAggregateInput
    _avg?: PublishedPlanAvgOrderByAggregateInput
    _max?: PublishedPlanMaxOrderByAggregateInput
    _min?: PublishedPlanMinOrderByAggregateInput
    _sum?: PublishedPlanSumOrderByAggregateInput
  }

  export type PublishedPlanScalarWhereWithAggregatesInput = {
    AND?: PublishedPlanScalarWhereWithAggregatesInput | PublishedPlanScalarWhereWithAggregatesInput[]
    OR?: PublishedPlanScalarWhereWithAggregatesInput[]
    NOT?: PublishedPlanScalarWhereWithAggregatesInput | PublishedPlanScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"PublishedPlan"> | string
    sourcePlanId?: StringWithAggregatesFilter<"PublishedPlan"> | string
    publisherId?: StringWithAggregatesFilter<"PublishedPlan"> | string
    title?: StringWithAggregatesFilter<"PublishedPlan"> | string
    description?: StringNullableWithAggregatesFilter<"PublishedPlan"> | string | null
    goal?: StringWithAggregatesFilter<"PublishedPlan"> | string
    moderationStatus?: EnumPublishModerationStatusWithAggregatesFilter<"PublishedPlan"> | $Enums.PublishModerationStatus
    moderationNote?: StringNullableWithAggregatesFilter<"PublishedPlan"> | string | null
    avgRating?: FloatWithAggregatesFilter<"PublishedPlan"> | number
    ratingCount?: IntWithAggregatesFilter<"PublishedPlan"> | number
    publishedAt?: DateTimeNullableWithAggregatesFilter<"PublishedPlan"> | Date | string | null
    createdAt?: DateTimeWithAggregatesFilter<"PublishedPlan"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"PublishedPlan"> | Date | string
  }

  export type PlanReviewWhereInput = {
    AND?: PlanReviewWhereInput | PlanReviewWhereInput[]
    OR?: PlanReviewWhereInput[]
    NOT?: PlanReviewWhereInput | PlanReviewWhereInput[]
    id?: StringFilter<"PlanReview"> | string
    publishedPlanId?: StringFilter<"PlanReview"> | string
    reviewerId?: StringFilter<"PlanReview"> | string
    rating?: IntFilter<"PlanReview"> | number
    comment?: StringNullableFilter<"PlanReview"> | string | null
    createdAt?: DateTimeFilter<"PlanReview"> | Date | string
    publishedPlan?: XOR<PublishedPlanRelationFilter, PublishedPlanWhereInput>
  }

  export type PlanReviewOrderByWithRelationInput = {
    id?: SortOrder
    publishedPlanId?: SortOrder
    reviewerId?: SortOrder
    rating?: SortOrder
    comment?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    publishedPlan?: PublishedPlanOrderByWithRelationInput
  }

  export type PlanReviewWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    publishedPlanId_reviewerId?: PlanReviewPublishedPlanIdReviewerIdCompoundUniqueInput
    AND?: PlanReviewWhereInput | PlanReviewWhereInput[]
    OR?: PlanReviewWhereInput[]
    NOT?: PlanReviewWhereInput | PlanReviewWhereInput[]
    publishedPlanId?: StringFilter<"PlanReview"> | string
    reviewerId?: StringFilter<"PlanReview"> | string
    rating?: IntFilter<"PlanReview"> | number
    comment?: StringNullableFilter<"PlanReview"> | string | null
    createdAt?: DateTimeFilter<"PlanReview"> | Date | string
    publishedPlan?: XOR<PublishedPlanRelationFilter, PublishedPlanWhereInput>
  }, "id" | "publishedPlanId_reviewerId">

  export type PlanReviewOrderByWithAggregationInput = {
    id?: SortOrder
    publishedPlanId?: SortOrder
    reviewerId?: SortOrder
    rating?: SortOrder
    comment?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    _count?: PlanReviewCountOrderByAggregateInput
    _avg?: PlanReviewAvgOrderByAggregateInput
    _max?: PlanReviewMaxOrderByAggregateInput
    _min?: PlanReviewMinOrderByAggregateInput
    _sum?: PlanReviewSumOrderByAggregateInput
  }

  export type PlanReviewScalarWhereWithAggregatesInput = {
    AND?: PlanReviewScalarWhereWithAggregatesInput | PlanReviewScalarWhereWithAggregatesInput[]
    OR?: PlanReviewScalarWhereWithAggregatesInput[]
    NOT?: PlanReviewScalarWhereWithAggregatesInput | PlanReviewScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"PlanReview"> | string
    publishedPlanId?: StringWithAggregatesFilter<"PlanReview"> | string
    reviewerId?: StringWithAggregatesFilter<"PlanReview"> | string
    rating?: IntWithAggregatesFilter<"PlanReview"> | number
    comment?: StringNullableWithAggregatesFilter<"PlanReview"> | string | null
    createdAt?: DateTimeWithAggregatesFilter<"PlanReview"> | Date | string
  }

  export type TrainingPackageWhereInput = {
    AND?: TrainingPackageWhereInput | TrainingPackageWhereInput[]
    OR?: TrainingPackageWhereInput[]
    NOT?: TrainingPackageWhereInput | TrainingPackageWhereInput[]
    id?: StringFilter<"TrainingPackage"> | string
    sellerId?: StringFilter<"TrainingPackage"> | string
    publishedPlanId?: StringFilter<"TrainingPackage"> | string
    name?: StringFilter<"TrainingPackage"> | string
    description?: StringNullableFilter<"TrainingPackage"> | string | null
    price?: FloatFilter<"TrainingPackage"> | number
    durationWeeks?: IntNullableFilter<"TrainingPackage"> | number | null
    status?: EnumTrainingPackageStatusFilter<"TrainingPackage"> | $Enums.TrainingPackageStatus
    createdAt?: DateTimeFilter<"TrainingPackage"> | Date | string
    updatedAt?: DateTimeFilter<"TrainingPackage"> | Date | string
    publishedPlan?: XOR<PublishedPlanRelationFilter, PublishedPlanWhereInput>
    purchases?: TrainingPackagePurchaseListRelationFilter
  }

  export type TrainingPackageOrderByWithRelationInput = {
    id?: SortOrder
    sellerId?: SortOrder
    publishedPlanId?: SortOrder
    name?: SortOrder
    description?: SortOrderInput | SortOrder
    price?: SortOrder
    durationWeeks?: SortOrderInput | SortOrder
    status?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    publishedPlan?: PublishedPlanOrderByWithRelationInput
    purchases?: TrainingPackagePurchaseOrderByRelationAggregateInput
  }

  export type TrainingPackageWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: TrainingPackageWhereInput | TrainingPackageWhereInput[]
    OR?: TrainingPackageWhereInput[]
    NOT?: TrainingPackageWhereInput | TrainingPackageWhereInput[]
    sellerId?: StringFilter<"TrainingPackage"> | string
    publishedPlanId?: StringFilter<"TrainingPackage"> | string
    name?: StringFilter<"TrainingPackage"> | string
    description?: StringNullableFilter<"TrainingPackage"> | string | null
    price?: FloatFilter<"TrainingPackage"> | number
    durationWeeks?: IntNullableFilter<"TrainingPackage"> | number | null
    status?: EnumTrainingPackageStatusFilter<"TrainingPackage"> | $Enums.TrainingPackageStatus
    createdAt?: DateTimeFilter<"TrainingPackage"> | Date | string
    updatedAt?: DateTimeFilter<"TrainingPackage"> | Date | string
    publishedPlan?: XOR<PublishedPlanRelationFilter, PublishedPlanWhereInput>
    purchases?: TrainingPackagePurchaseListRelationFilter
  }, "id">

  export type TrainingPackageOrderByWithAggregationInput = {
    id?: SortOrder
    sellerId?: SortOrder
    publishedPlanId?: SortOrder
    name?: SortOrder
    description?: SortOrderInput | SortOrder
    price?: SortOrder
    durationWeeks?: SortOrderInput | SortOrder
    status?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: TrainingPackageCountOrderByAggregateInput
    _avg?: TrainingPackageAvgOrderByAggregateInput
    _max?: TrainingPackageMaxOrderByAggregateInput
    _min?: TrainingPackageMinOrderByAggregateInput
    _sum?: TrainingPackageSumOrderByAggregateInput
  }

  export type TrainingPackageScalarWhereWithAggregatesInput = {
    AND?: TrainingPackageScalarWhereWithAggregatesInput | TrainingPackageScalarWhereWithAggregatesInput[]
    OR?: TrainingPackageScalarWhereWithAggregatesInput[]
    NOT?: TrainingPackageScalarWhereWithAggregatesInput | TrainingPackageScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"TrainingPackage"> | string
    sellerId?: StringWithAggregatesFilter<"TrainingPackage"> | string
    publishedPlanId?: StringWithAggregatesFilter<"TrainingPackage"> | string
    name?: StringWithAggregatesFilter<"TrainingPackage"> | string
    description?: StringNullableWithAggregatesFilter<"TrainingPackage"> | string | null
    price?: FloatWithAggregatesFilter<"TrainingPackage"> | number
    durationWeeks?: IntNullableWithAggregatesFilter<"TrainingPackage"> | number | null
    status?: EnumTrainingPackageStatusWithAggregatesFilter<"TrainingPackage"> | $Enums.TrainingPackageStatus
    createdAt?: DateTimeWithAggregatesFilter<"TrainingPackage"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"TrainingPackage"> | Date | string
  }

  export type TrainingPackagePurchaseWhereInput = {
    AND?: TrainingPackagePurchaseWhereInput | TrainingPackagePurchaseWhereInput[]
    OR?: TrainingPackagePurchaseWhereInput[]
    NOT?: TrainingPackagePurchaseWhereInput | TrainingPackagePurchaseWhereInput[]
    id?: StringFilter<"TrainingPackagePurchase"> | string
    packageId?: StringFilter<"TrainingPackagePurchase"> | string
    buyerId?: StringFilter<"TrainingPackagePurchase"> | string
    priceAtPurchase?: FloatFilter<"TrainingPackagePurchase"> | number
    paymentTransactionId?: StringNullableFilter<"TrainingPackagePurchase"> | string | null
    status?: EnumTrainingPackagePurchaseStatusFilter<"TrainingPackagePurchase"> | $Enums.TrainingPackagePurchaseStatus
    purchasedAt?: DateTimeNullableFilter<"TrainingPackagePurchase"> | Date | string | null
    createdAt?: DateTimeFilter<"TrainingPackagePurchase"> | Date | string
    updatedAt?: DateTimeFilter<"TrainingPackagePurchase"> | Date | string
    package?: XOR<TrainingPackageRelationFilter, TrainingPackageWhereInput>
  }

  export type TrainingPackagePurchaseOrderByWithRelationInput = {
    id?: SortOrder
    packageId?: SortOrder
    buyerId?: SortOrder
    priceAtPurchase?: SortOrder
    paymentTransactionId?: SortOrderInput | SortOrder
    status?: SortOrder
    purchasedAt?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    package?: TrainingPackageOrderByWithRelationInput
  }

  export type TrainingPackagePurchaseWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    packageId_buyerId?: TrainingPackagePurchasePackageIdBuyerIdCompoundUniqueInput
    AND?: TrainingPackagePurchaseWhereInput | TrainingPackagePurchaseWhereInput[]
    OR?: TrainingPackagePurchaseWhereInput[]
    NOT?: TrainingPackagePurchaseWhereInput | TrainingPackagePurchaseWhereInput[]
    packageId?: StringFilter<"TrainingPackagePurchase"> | string
    buyerId?: StringFilter<"TrainingPackagePurchase"> | string
    priceAtPurchase?: FloatFilter<"TrainingPackagePurchase"> | number
    paymentTransactionId?: StringNullableFilter<"TrainingPackagePurchase"> | string | null
    status?: EnumTrainingPackagePurchaseStatusFilter<"TrainingPackagePurchase"> | $Enums.TrainingPackagePurchaseStatus
    purchasedAt?: DateTimeNullableFilter<"TrainingPackagePurchase"> | Date | string | null
    createdAt?: DateTimeFilter<"TrainingPackagePurchase"> | Date | string
    updatedAt?: DateTimeFilter<"TrainingPackagePurchase"> | Date | string
    package?: XOR<TrainingPackageRelationFilter, TrainingPackageWhereInput>
  }, "id" | "packageId_buyerId">

  export type TrainingPackagePurchaseOrderByWithAggregationInput = {
    id?: SortOrder
    packageId?: SortOrder
    buyerId?: SortOrder
    priceAtPurchase?: SortOrder
    paymentTransactionId?: SortOrderInput | SortOrder
    status?: SortOrder
    purchasedAt?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: TrainingPackagePurchaseCountOrderByAggregateInput
    _avg?: TrainingPackagePurchaseAvgOrderByAggregateInput
    _max?: TrainingPackagePurchaseMaxOrderByAggregateInput
    _min?: TrainingPackagePurchaseMinOrderByAggregateInput
    _sum?: TrainingPackagePurchaseSumOrderByAggregateInput
  }

  export type TrainingPackagePurchaseScalarWhereWithAggregatesInput = {
    AND?: TrainingPackagePurchaseScalarWhereWithAggregatesInput | TrainingPackagePurchaseScalarWhereWithAggregatesInput[]
    OR?: TrainingPackagePurchaseScalarWhereWithAggregatesInput[]
    NOT?: TrainingPackagePurchaseScalarWhereWithAggregatesInput | TrainingPackagePurchaseScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"TrainingPackagePurchase"> | string
    packageId?: StringWithAggregatesFilter<"TrainingPackagePurchase"> | string
    buyerId?: StringWithAggregatesFilter<"TrainingPackagePurchase"> | string
    priceAtPurchase?: FloatWithAggregatesFilter<"TrainingPackagePurchase"> | number
    paymentTransactionId?: StringNullableWithAggregatesFilter<"TrainingPackagePurchase"> | string | null
    status?: EnumTrainingPackagePurchaseStatusWithAggregatesFilter<"TrainingPackagePurchase"> | $Enums.TrainingPackagePurchaseStatus
    purchasedAt?: DateTimeNullableWithAggregatesFilter<"TrainingPackagePurchase"> | Date | string | null
    createdAt?: DateTimeWithAggregatesFilter<"TrainingPackagePurchase"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"TrainingPackagePurchase"> | Date | string
  }

  export type NutritionPlanWhereInput = {
    AND?: NutritionPlanWhereInput | NutritionPlanWhereInput[]
    OR?: NutritionPlanWhereInput[]
    NOT?: NutritionPlanWhereInput | NutritionPlanWhereInput[]
    id?: StringFilter<"NutritionPlan"> | string
    userId?: StringFilter<"NutritionPlan"> | string
    name?: StringFilter<"NutritionPlan"> | string
    goal?: StringFilter<"NutritionPlan"> | string
    durationWeeks?: IntFilter<"NutritionPlan"> | number
    mealsPerDay?: IntFilter<"NutritionPlan"> | number
    plan?: JsonFilter<"NutritionPlan">
    status?: EnumPlanStatusFilter<"NutritionPlan"> | $Enums.PlanStatus
    jobId?: StringNullableFilter<"NutritionPlan"> | string | null
    failReason?: StringNullableFilter<"NutritionPlan"> | string | null
    archivedAt?: DateTimeNullableFilter<"NutritionPlan"> | Date | string | null
    createdAt?: DateTimeFilter<"NutritionPlan"> | Date | string
    updatedAt?: DateTimeFilter<"NutritionPlan"> | Date | string
  }

  export type NutritionPlanOrderByWithRelationInput = {
    id?: SortOrder
    userId?: SortOrder
    name?: SortOrder
    goal?: SortOrder
    durationWeeks?: SortOrder
    mealsPerDay?: SortOrder
    plan?: SortOrder
    status?: SortOrder
    jobId?: SortOrderInput | SortOrder
    failReason?: SortOrderInput | SortOrder
    archivedAt?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type NutritionPlanWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: NutritionPlanWhereInput | NutritionPlanWhereInput[]
    OR?: NutritionPlanWhereInput[]
    NOT?: NutritionPlanWhereInput | NutritionPlanWhereInput[]
    userId?: StringFilter<"NutritionPlan"> | string
    name?: StringFilter<"NutritionPlan"> | string
    goal?: StringFilter<"NutritionPlan"> | string
    durationWeeks?: IntFilter<"NutritionPlan"> | number
    mealsPerDay?: IntFilter<"NutritionPlan"> | number
    plan?: JsonFilter<"NutritionPlan">
    status?: EnumPlanStatusFilter<"NutritionPlan"> | $Enums.PlanStatus
    jobId?: StringNullableFilter<"NutritionPlan"> | string | null
    failReason?: StringNullableFilter<"NutritionPlan"> | string | null
    archivedAt?: DateTimeNullableFilter<"NutritionPlan"> | Date | string | null
    createdAt?: DateTimeFilter<"NutritionPlan"> | Date | string
    updatedAt?: DateTimeFilter<"NutritionPlan"> | Date | string
  }, "id">

  export type NutritionPlanOrderByWithAggregationInput = {
    id?: SortOrder
    userId?: SortOrder
    name?: SortOrder
    goal?: SortOrder
    durationWeeks?: SortOrder
    mealsPerDay?: SortOrder
    plan?: SortOrder
    status?: SortOrder
    jobId?: SortOrderInput | SortOrder
    failReason?: SortOrderInput | SortOrder
    archivedAt?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: NutritionPlanCountOrderByAggregateInput
    _avg?: NutritionPlanAvgOrderByAggregateInput
    _max?: NutritionPlanMaxOrderByAggregateInput
    _min?: NutritionPlanMinOrderByAggregateInput
    _sum?: NutritionPlanSumOrderByAggregateInput
  }

  export type NutritionPlanScalarWhereWithAggregatesInput = {
    AND?: NutritionPlanScalarWhereWithAggregatesInput | NutritionPlanScalarWhereWithAggregatesInput[]
    OR?: NutritionPlanScalarWhereWithAggregatesInput[]
    NOT?: NutritionPlanScalarWhereWithAggregatesInput | NutritionPlanScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"NutritionPlan"> | string
    userId?: StringWithAggregatesFilter<"NutritionPlan"> | string
    name?: StringWithAggregatesFilter<"NutritionPlan"> | string
    goal?: StringWithAggregatesFilter<"NutritionPlan"> | string
    durationWeeks?: IntWithAggregatesFilter<"NutritionPlan"> | number
    mealsPerDay?: IntWithAggregatesFilter<"NutritionPlan"> | number
    plan?: JsonWithAggregatesFilter<"NutritionPlan">
    status?: EnumPlanStatusWithAggregatesFilter<"NutritionPlan"> | $Enums.PlanStatus
    jobId?: StringNullableWithAggregatesFilter<"NutritionPlan"> | string | null
    failReason?: StringNullableWithAggregatesFilter<"NutritionPlan"> | string | null
    archivedAt?: DateTimeNullableWithAggregatesFilter<"NutritionPlan"> | Date | string | null
    createdAt?: DateTimeWithAggregatesFilter<"NutritionPlan"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"NutritionPlan"> | Date | string
  }

  export type KnowledgeSourceWhereInput = {
    AND?: KnowledgeSourceWhereInput | KnowledgeSourceWhereInput[]
    OR?: KnowledgeSourceWhereInput[]
    NOT?: KnowledgeSourceWhereInput | KnowledgeSourceWhereInput[]
    id?: StringFilter<"KnowledgeSource"> | string
    name?: StringFilter<"KnowledgeSource"> | string
    baseUrl?: StringFilter<"KnowledgeSource"> | string
    sourceType?: EnumKnowledgeSourceTypeFilter<"KnowledgeSource"> | $Enums.KnowledgeSourceType
    trustTier?: IntFilter<"KnowledgeSource"> | number
    crawlCron?: StringFilter<"KnowledgeSource"> | string
    isActive?: BoolFilter<"KnowledgeSource"> | boolean
    lastCrawledAt?: DateTimeNullableFilter<"KnowledgeSource"> | Date | string | null
    createdAt?: DateTimeFilter<"KnowledgeSource"> | Date | string
    documents?: KnowledgeDocumentListRelationFilter
  }

  export type KnowledgeSourceOrderByWithRelationInput = {
    id?: SortOrder
    name?: SortOrder
    baseUrl?: SortOrder
    sourceType?: SortOrder
    trustTier?: SortOrder
    crawlCron?: SortOrder
    isActive?: SortOrder
    lastCrawledAt?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    documents?: KnowledgeDocumentOrderByRelationAggregateInput
  }

  export type KnowledgeSourceWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    baseUrl?: string
    AND?: KnowledgeSourceWhereInput | KnowledgeSourceWhereInput[]
    OR?: KnowledgeSourceWhereInput[]
    NOT?: KnowledgeSourceWhereInput | KnowledgeSourceWhereInput[]
    name?: StringFilter<"KnowledgeSource"> | string
    sourceType?: EnumKnowledgeSourceTypeFilter<"KnowledgeSource"> | $Enums.KnowledgeSourceType
    trustTier?: IntFilter<"KnowledgeSource"> | number
    crawlCron?: StringFilter<"KnowledgeSource"> | string
    isActive?: BoolFilter<"KnowledgeSource"> | boolean
    lastCrawledAt?: DateTimeNullableFilter<"KnowledgeSource"> | Date | string | null
    createdAt?: DateTimeFilter<"KnowledgeSource"> | Date | string
    documents?: KnowledgeDocumentListRelationFilter
  }, "id" | "baseUrl">

  export type KnowledgeSourceOrderByWithAggregationInput = {
    id?: SortOrder
    name?: SortOrder
    baseUrl?: SortOrder
    sourceType?: SortOrder
    trustTier?: SortOrder
    crawlCron?: SortOrder
    isActive?: SortOrder
    lastCrawledAt?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    _count?: KnowledgeSourceCountOrderByAggregateInput
    _avg?: KnowledgeSourceAvgOrderByAggregateInput
    _max?: KnowledgeSourceMaxOrderByAggregateInput
    _min?: KnowledgeSourceMinOrderByAggregateInput
    _sum?: KnowledgeSourceSumOrderByAggregateInput
  }

  export type KnowledgeSourceScalarWhereWithAggregatesInput = {
    AND?: KnowledgeSourceScalarWhereWithAggregatesInput | KnowledgeSourceScalarWhereWithAggregatesInput[]
    OR?: KnowledgeSourceScalarWhereWithAggregatesInput[]
    NOT?: KnowledgeSourceScalarWhereWithAggregatesInput | KnowledgeSourceScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"KnowledgeSource"> | string
    name?: StringWithAggregatesFilter<"KnowledgeSource"> | string
    baseUrl?: StringWithAggregatesFilter<"KnowledgeSource"> | string
    sourceType?: EnumKnowledgeSourceTypeWithAggregatesFilter<"KnowledgeSource"> | $Enums.KnowledgeSourceType
    trustTier?: IntWithAggregatesFilter<"KnowledgeSource"> | number
    crawlCron?: StringWithAggregatesFilter<"KnowledgeSource"> | string
    isActive?: BoolWithAggregatesFilter<"KnowledgeSource"> | boolean
    lastCrawledAt?: DateTimeNullableWithAggregatesFilter<"KnowledgeSource"> | Date | string | null
    createdAt?: DateTimeWithAggregatesFilter<"KnowledgeSource"> | Date | string
  }

  export type KnowledgeDocumentWhereInput = {
    AND?: KnowledgeDocumentWhereInput | KnowledgeDocumentWhereInput[]
    OR?: KnowledgeDocumentWhereInput[]
    NOT?: KnowledgeDocumentWhereInput | KnowledgeDocumentWhereInput[]
    id?: StringFilter<"KnowledgeDocument"> | string
    sourceId?: StringFilter<"KnowledgeDocument"> | string
    url?: StringFilter<"KnowledgeDocument"> | string
    title?: StringNullableFilter<"KnowledgeDocument"> | string | null
    author?: StringNullableFilter<"KnowledgeDocument"> | string | null
    language?: StringNullableFilter<"KnowledgeDocument"> | string | null
    contentHash?: StringFilter<"KnowledgeDocument"> | string
    rawObjectKey?: StringNullableFilter<"KnowledgeDocument"> | string | null
    cleanText?: StringNullableFilter<"KnowledgeDocument"> | string | null
    topic?: EnumKnowledgeDocumentTopicNullableFilter<"KnowledgeDocument"> | $Enums.KnowledgeDocumentTopic | null
    trustScore?: DecimalNullableFilter<"KnowledgeDocument"> | Decimal | DecimalJsLike | number | string | null
    qualityScore?: DecimalNullableFilter<"KnowledgeDocument"> | Decimal | DecimalJsLike | number | string | null
    safetyFlag?: BoolFilter<"KnowledgeDocument"> | boolean
    status?: EnumKnowledgeDocumentStatusFilter<"KnowledgeDocument"> | $Enums.KnowledgeDocumentStatus
    rejectionReason?: StringNullableFilter<"KnowledgeDocument"> | string | null
    publishedAt?: DateTimeNullableFilter<"KnowledgeDocument"> | Date | string | null
    crawledAt?: DateTimeFilter<"KnowledgeDocument"> | Date | string
    processedAt?: DateTimeNullableFilter<"KnowledgeDocument"> | Date | string | null
    source?: XOR<KnowledgeSourceRelationFilter, KnowledgeSourceWhereInput>
    chunks?: KnowledgeChunkListRelationFilter
    reviewItems?: KnowledgeReviewItemListRelationFilter
  }

  export type KnowledgeDocumentOrderByWithRelationInput = {
    id?: SortOrder
    sourceId?: SortOrder
    url?: SortOrder
    title?: SortOrderInput | SortOrder
    author?: SortOrderInput | SortOrder
    language?: SortOrderInput | SortOrder
    contentHash?: SortOrder
    rawObjectKey?: SortOrderInput | SortOrder
    cleanText?: SortOrderInput | SortOrder
    topic?: SortOrderInput | SortOrder
    trustScore?: SortOrderInput | SortOrder
    qualityScore?: SortOrderInput | SortOrder
    safetyFlag?: SortOrder
    status?: SortOrder
    rejectionReason?: SortOrderInput | SortOrder
    publishedAt?: SortOrderInput | SortOrder
    crawledAt?: SortOrder
    processedAt?: SortOrderInput | SortOrder
    source?: KnowledgeSourceOrderByWithRelationInput
    chunks?: KnowledgeChunkOrderByRelationAggregateInput
    reviewItems?: KnowledgeReviewItemOrderByRelationAggregateInput
  }

  export type KnowledgeDocumentWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    contentHash?: string
    AND?: KnowledgeDocumentWhereInput | KnowledgeDocumentWhereInput[]
    OR?: KnowledgeDocumentWhereInput[]
    NOT?: KnowledgeDocumentWhereInput | KnowledgeDocumentWhereInput[]
    sourceId?: StringFilter<"KnowledgeDocument"> | string
    url?: StringFilter<"KnowledgeDocument"> | string
    title?: StringNullableFilter<"KnowledgeDocument"> | string | null
    author?: StringNullableFilter<"KnowledgeDocument"> | string | null
    language?: StringNullableFilter<"KnowledgeDocument"> | string | null
    rawObjectKey?: StringNullableFilter<"KnowledgeDocument"> | string | null
    cleanText?: StringNullableFilter<"KnowledgeDocument"> | string | null
    topic?: EnumKnowledgeDocumentTopicNullableFilter<"KnowledgeDocument"> | $Enums.KnowledgeDocumentTopic | null
    trustScore?: DecimalNullableFilter<"KnowledgeDocument"> | Decimal | DecimalJsLike | number | string | null
    qualityScore?: DecimalNullableFilter<"KnowledgeDocument"> | Decimal | DecimalJsLike | number | string | null
    safetyFlag?: BoolFilter<"KnowledgeDocument"> | boolean
    status?: EnumKnowledgeDocumentStatusFilter<"KnowledgeDocument"> | $Enums.KnowledgeDocumentStatus
    rejectionReason?: StringNullableFilter<"KnowledgeDocument"> | string | null
    publishedAt?: DateTimeNullableFilter<"KnowledgeDocument"> | Date | string | null
    crawledAt?: DateTimeFilter<"KnowledgeDocument"> | Date | string
    processedAt?: DateTimeNullableFilter<"KnowledgeDocument"> | Date | string | null
    source?: XOR<KnowledgeSourceRelationFilter, KnowledgeSourceWhereInput>
    chunks?: KnowledgeChunkListRelationFilter
    reviewItems?: KnowledgeReviewItemListRelationFilter
  }, "id" | "contentHash">

  export type KnowledgeDocumentOrderByWithAggregationInput = {
    id?: SortOrder
    sourceId?: SortOrder
    url?: SortOrder
    title?: SortOrderInput | SortOrder
    author?: SortOrderInput | SortOrder
    language?: SortOrderInput | SortOrder
    contentHash?: SortOrder
    rawObjectKey?: SortOrderInput | SortOrder
    cleanText?: SortOrderInput | SortOrder
    topic?: SortOrderInput | SortOrder
    trustScore?: SortOrderInput | SortOrder
    qualityScore?: SortOrderInput | SortOrder
    safetyFlag?: SortOrder
    status?: SortOrder
    rejectionReason?: SortOrderInput | SortOrder
    publishedAt?: SortOrderInput | SortOrder
    crawledAt?: SortOrder
    processedAt?: SortOrderInput | SortOrder
    _count?: KnowledgeDocumentCountOrderByAggregateInput
    _avg?: KnowledgeDocumentAvgOrderByAggregateInput
    _max?: KnowledgeDocumentMaxOrderByAggregateInput
    _min?: KnowledgeDocumentMinOrderByAggregateInput
    _sum?: KnowledgeDocumentSumOrderByAggregateInput
  }

  export type KnowledgeDocumentScalarWhereWithAggregatesInput = {
    AND?: KnowledgeDocumentScalarWhereWithAggregatesInput | KnowledgeDocumentScalarWhereWithAggregatesInput[]
    OR?: KnowledgeDocumentScalarWhereWithAggregatesInput[]
    NOT?: KnowledgeDocumentScalarWhereWithAggregatesInput | KnowledgeDocumentScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"KnowledgeDocument"> | string
    sourceId?: StringWithAggregatesFilter<"KnowledgeDocument"> | string
    url?: StringWithAggregatesFilter<"KnowledgeDocument"> | string
    title?: StringNullableWithAggregatesFilter<"KnowledgeDocument"> | string | null
    author?: StringNullableWithAggregatesFilter<"KnowledgeDocument"> | string | null
    language?: StringNullableWithAggregatesFilter<"KnowledgeDocument"> | string | null
    contentHash?: StringWithAggregatesFilter<"KnowledgeDocument"> | string
    rawObjectKey?: StringNullableWithAggregatesFilter<"KnowledgeDocument"> | string | null
    cleanText?: StringNullableWithAggregatesFilter<"KnowledgeDocument"> | string | null
    topic?: EnumKnowledgeDocumentTopicNullableWithAggregatesFilter<"KnowledgeDocument"> | $Enums.KnowledgeDocumentTopic | null
    trustScore?: DecimalNullableWithAggregatesFilter<"KnowledgeDocument"> | Decimal | DecimalJsLike | number | string | null
    qualityScore?: DecimalNullableWithAggregatesFilter<"KnowledgeDocument"> | Decimal | DecimalJsLike | number | string | null
    safetyFlag?: BoolWithAggregatesFilter<"KnowledgeDocument"> | boolean
    status?: EnumKnowledgeDocumentStatusWithAggregatesFilter<"KnowledgeDocument"> | $Enums.KnowledgeDocumentStatus
    rejectionReason?: StringNullableWithAggregatesFilter<"KnowledgeDocument"> | string | null
    publishedAt?: DateTimeNullableWithAggregatesFilter<"KnowledgeDocument"> | Date | string | null
    crawledAt?: DateTimeWithAggregatesFilter<"KnowledgeDocument"> | Date | string
    processedAt?: DateTimeNullableWithAggregatesFilter<"KnowledgeDocument"> | Date | string | null
  }

  export type KnowledgeChunkWhereInput = {
    AND?: KnowledgeChunkWhereInput | KnowledgeChunkWhereInput[]
    OR?: KnowledgeChunkWhereInput[]
    NOT?: KnowledgeChunkWhereInput | KnowledgeChunkWhereInput[]
    id?: StringFilter<"KnowledgeChunk"> | string
    documentId?: StringFilter<"KnowledgeChunk"> | string
    chunkIndex?: IntFilter<"KnowledgeChunk"> | number
    text?: StringFilter<"KnowledgeChunk"> | string
    tokenCount?: IntNullableFilter<"KnowledgeChunk"> | number | null
    vectorId?: StringFilter<"KnowledgeChunk"> | string
    embeddedAt?: DateTimeFilter<"KnowledgeChunk"> | Date | string
    document?: XOR<KnowledgeDocumentRelationFilter, KnowledgeDocumentWhereInput>
  }

  export type KnowledgeChunkOrderByWithRelationInput = {
    id?: SortOrder
    documentId?: SortOrder
    chunkIndex?: SortOrder
    text?: SortOrder
    tokenCount?: SortOrderInput | SortOrder
    vectorId?: SortOrder
    embeddedAt?: SortOrder
    document?: KnowledgeDocumentOrderByWithRelationInput
  }

  export type KnowledgeChunkWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    documentId_chunkIndex?: KnowledgeChunkDocumentIdChunkIndexCompoundUniqueInput
    AND?: KnowledgeChunkWhereInput | KnowledgeChunkWhereInput[]
    OR?: KnowledgeChunkWhereInput[]
    NOT?: KnowledgeChunkWhereInput | KnowledgeChunkWhereInput[]
    documentId?: StringFilter<"KnowledgeChunk"> | string
    chunkIndex?: IntFilter<"KnowledgeChunk"> | number
    text?: StringFilter<"KnowledgeChunk"> | string
    tokenCount?: IntNullableFilter<"KnowledgeChunk"> | number | null
    vectorId?: StringFilter<"KnowledgeChunk"> | string
    embeddedAt?: DateTimeFilter<"KnowledgeChunk"> | Date | string
    document?: XOR<KnowledgeDocumentRelationFilter, KnowledgeDocumentWhereInput>
  }, "id" | "documentId_chunkIndex">

  export type KnowledgeChunkOrderByWithAggregationInput = {
    id?: SortOrder
    documentId?: SortOrder
    chunkIndex?: SortOrder
    text?: SortOrder
    tokenCount?: SortOrderInput | SortOrder
    vectorId?: SortOrder
    embeddedAt?: SortOrder
    _count?: KnowledgeChunkCountOrderByAggregateInput
    _avg?: KnowledgeChunkAvgOrderByAggregateInput
    _max?: KnowledgeChunkMaxOrderByAggregateInput
    _min?: KnowledgeChunkMinOrderByAggregateInput
    _sum?: KnowledgeChunkSumOrderByAggregateInput
  }

  export type KnowledgeChunkScalarWhereWithAggregatesInput = {
    AND?: KnowledgeChunkScalarWhereWithAggregatesInput | KnowledgeChunkScalarWhereWithAggregatesInput[]
    OR?: KnowledgeChunkScalarWhereWithAggregatesInput[]
    NOT?: KnowledgeChunkScalarWhereWithAggregatesInput | KnowledgeChunkScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"KnowledgeChunk"> | string
    documentId?: StringWithAggregatesFilter<"KnowledgeChunk"> | string
    chunkIndex?: IntWithAggregatesFilter<"KnowledgeChunk"> | number
    text?: StringWithAggregatesFilter<"KnowledgeChunk"> | string
    tokenCount?: IntNullableWithAggregatesFilter<"KnowledgeChunk"> | number | null
    vectorId?: StringWithAggregatesFilter<"KnowledgeChunk"> | string
    embeddedAt?: DateTimeWithAggregatesFilter<"KnowledgeChunk"> | Date | string
  }

  export type KnowledgePipelineRunWhereInput = {
    AND?: KnowledgePipelineRunWhereInput | KnowledgePipelineRunWhereInput[]
    OR?: KnowledgePipelineRunWhereInput[]
    NOT?: KnowledgePipelineRunWhereInput | KnowledgePipelineRunWhereInput[]
    id?: StringFilter<"KnowledgePipelineRun"> | string
    runType?: StringFilter<"KnowledgePipelineRun"> | string
    startedAt?: DateTimeFilter<"KnowledgePipelineRun"> | Date | string
    finishedAt?: DateTimeNullableFilter<"KnowledgePipelineRun"> | Date | string | null
    docsCrawled?: IntFilter<"KnowledgePipelineRun"> | number
    docsAccepted?: IntFilter<"KnowledgePipelineRun"> | number
    docsRejected?: IntFilter<"KnowledgePipelineRun"> | number
    docsReview?: IntFilter<"KnowledgePipelineRun"> | number
    status?: EnumKnowledgePipelineRunStatusFilter<"KnowledgePipelineRun"> | $Enums.KnowledgePipelineRunStatus
  }

  export type KnowledgePipelineRunOrderByWithRelationInput = {
    id?: SortOrder
    runType?: SortOrder
    startedAt?: SortOrder
    finishedAt?: SortOrderInput | SortOrder
    docsCrawled?: SortOrder
    docsAccepted?: SortOrder
    docsRejected?: SortOrder
    docsReview?: SortOrder
    status?: SortOrder
  }

  export type KnowledgePipelineRunWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: KnowledgePipelineRunWhereInput | KnowledgePipelineRunWhereInput[]
    OR?: KnowledgePipelineRunWhereInput[]
    NOT?: KnowledgePipelineRunWhereInput | KnowledgePipelineRunWhereInput[]
    runType?: StringFilter<"KnowledgePipelineRun"> | string
    startedAt?: DateTimeFilter<"KnowledgePipelineRun"> | Date | string
    finishedAt?: DateTimeNullableFilter<"KnowledgePipelineRun"> | Date | string | null
    docsCrawled?: IntFilter<"KnowledgePipelineRun"> | number
    docsAccepted?: IntFilter<"KnowledgePipelineRun"> | number
    docsRejected?: IntFilter<"KnowledgePipelineRun"> | number
    docsReview?: IntFilter<"KnowledgePipelineRun"> | number
    status?: EnumKnowledgePipelineRunStatusFilter<"KnowledgePipelineRun"> | $Enums.KnowledgePipelineRunStatus
  }, "id">

  export type KnowledgePipelineRunOrderByWithAggregationInput = {
    id?: SortOrder
    runType?: SortOrder
    startedAt?: SortOrder
    finishedAt?: SortOrderInput | SortOrder
    docsCrawled?: SortOrder
    docsAccepted?: SortOrder
    docsRejected?: SortOrder
    docsReview?: SortOrder
    status?: SortOrder
    _count?: KnowledgePipelineRunCountOrderByAggregateInput
    _avg?: KnowledgePipelineRunAvgOrderByAggregateInput
    _max?: KnowledgePipelineRunMaxOrderByAggregateInput
    _min?: KnowledgePipelineRunMinOrderByAggregateInput
    _sum?: KnowledgePipelineRunSumOrderByAggregateInput
  }

  export type KnowledgePipelineRunScalarWhereWithAggregatesInput = {
    AND?: KnowledgePipelineRunScalarWhereWithAggregatesInput | KnowledgePipelineRunScalarWhereWithAggregatesInput[]
    OR?: KnowledgePipelineRunScalarWhereWithAggregatesInput[]
    NOT?: KnowledgePipelineRunScalarWhereWithAggregatesInput | KnowledgePipelineRunScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"KnowledgePipelineRun"> | string
    runType?: StringWithAggregatesFilter<"KnowledgePipelineRun"> | string
    startedAt?: DateTimeWithAggregatesFilter<"KnowledgePipelineRun"> | Date | string
    finishedAt?: DateTimeNullableWithAggregatesFilter<"KnowledgePipelineRun"> | Date | string | null
    docsCrawled?: IntWithAggregatesFilter<"KnowledgePipelineRun"> | number
    docsAccepted?: IntWithAggregatesFilter<"KnowledgePipelineRun"> | number
    docsRejected?: IntWithAggregatesFilter<"KnowledgePipelineRun"> | number
    docsReview?: IntWithAggregatesFilter<"KnowledgePipelineRun"> | number
    status?: EnumKnowledgePipelineRunStatusWithAggregatesFilter<"KnowledgePipelineRun"> | $Enums.KnowledgePipelineRunStatus
  }

  export type KnowledgeReviewItemWhereInput = {
    AND?: KnowledgeReviewItemWhereInput | KnowledgeReviewItemWhereInput[]
    OR?: KnowledgeReviewItemWhereInput[]
    NOT?: KnowledgeReviewItemWhereInput | KnowledgeReviewItemWhereInput[]
    id?: StringFilter<"KnowledgeReviewItem"> | string
    documentId?: StringFilter<"KnowledgeReviewItem"> | string
    reason?: StringNullableFilter<"KnowledgeReviewItem"> | string | null
    status?: EnumKnowledgeReviewStatusFilter<"KnowledgeReviewItem"> | $Enums.KnowledgeReviewStatus
    reviewedBy?: StringNullableFilter<"KnowledgeReviewItem"> | string | null
    reviewedAt?: DateTimeNullableFilter<"KnowledgeReviewItem"> | Date | string | null
    document?: XOR<KnowledgeDocumentRelationFilter, KnowledgeDocumentWhereInput>
  }

  export type KnowledgeReviewItemOrderByWithRelationInput = {
    id?: SortOrder
    documentId?: SortOrder
    reason?: SortOrderInput | SortOrder
    status?: SortOrder
    reviewedBy?: SortOrderInput | SortOrder
    reviewedAt?: SortOrderInput | SortOrder
    document?: KnowledgeDocumentOrderByWithRelationInput
  }

  export type KnowledgeReviewItemWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: KnowledgeReviewItemWhereInput | KnowledgeReviewItemWhereInput[]
    OR?: KnowledgeReviewItemWhereInput[]
    NOT?: KnowledgeReviewItemWhereInput | KnowledgeReviewItemWhereInput[]
    documentId?: StringFilter<"KnowledgeReviewItem"> | string
    reason?: StringNullableFilter<"KnowledgeReviewItem"> | string | null
    status?: EnumKnowledgeReviewStatusFilter<"KnowledgeReviewItem"> | $Enums.KnowledgeReviewStatus
    reviewedBy?: StringNullableFilter<"KnowledgeReviewItem"> | string | null
    reviewedAt?: DateTimeNullableFilter<"KnowledgeReviewItem"> | Date | string | null
    document?: XOR<KnowledgeDocumentRelationFilter, KnowledgeDocumentWhereInput>
  }, "id">

  export type KnowledgeReviewItemOrderByWithAggregationInput = {
    id?: SortOrder
    documentId?: SortOrder
    reason?: SortOrderInput | SortOrder
    status?: SortOrder
    reviewedBy?: SortOrderInput | SortOrder
    reviewedAt?: SortOrderInput | SortOrder
    _count?: KnowledgeReviewItemCountOrderByAggregateInput
    _max?: KnowledgeReviewItemMaxOrderByAggregateInput
    _min?: KnowledgeReviewItemMinOrderByAggregateInput
  }

  export type KnowledgeReviewItemScalarWhereWithAggregatesInput = {
    AND?: KnowledgeReviewItemScalarWhereWithAggregatesInput | KnowledgeReviewItemScalarWhereWithAggregatesInput[]
    OR?: KnowledgeReviewItemScalarWhereWithAggregatesInput[]
    NOT?: KnowledgeReviewItemScalarWhereWithAggregatesInput | KnowledgeReviewItemScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"KnowledgeReviewItem"> | string
    documentId?: StringWithAggregatesFilter<"KnowledgeReviewItem"> | string
    reason?: StringNullableWithAggregatesFilter<"KnowledgeReviewItem"> | string | null
    status?: EnumKnowledgeReviewStatusWithAggregatesFilter<"KnowledgeReviewItem"> | $Enums.KnowledgeReviewStatus
    reviewedBy?: StringNullableWithAggregatesFilter<"KnowledgeReviewItem"> | string | null
    reviewedAt?: DateTimeNullableWithAggregatesFilter<"KnowledgeReviewItem"> | Date | string | null
  }

  export type ConversationCreateInput = {
    id?: string
    userId?: string | null
    sessionId?: string | null
    question: string
    answer: string
    modelUsed: string
    responseTime: number
    relevance?: string | null
    relevanceExplanation?: string | null
    promptTokens: number
    completionTokens: number
    totalTokens: number
    cost?: number
    feedback?: number | null
    feedbackTimestamp?: Date | string | null
    traceId?: string | null
    usedFallback?: boolean
    usedDeterministicFallback?: boolean
    responseLanguage?: string | null
    routeIntent?: string | null
    warningCount?: number
    createdAt?: Date | string
  }

  export type ConversationUncheckedCreateInput = {
    id?: string
    userId?: string | null
    sessionId?: string | null
    question: string
    answer: string
    modelUsed: string
    responseTime: number
    relevance?: string | null
    relevanceExplanation?: string | null
    promptTokens: number
    completionTokens: number
    totalTokens: number
    cost?: number
    feedback?: number | null
    feedbackTimestamp?: Date | string | null
    traceId?: string | null
    usedFallback?: boolean
    usedDeterministicFallback?: boolean
    responseLanguage?: string | null
    routeIntent?: string | null
    warningCount?: number
    createdAt?: Date | string
  }

  export type ConversationUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: NullableStringFieldUpdateOperationsInput | string | null
    sessionId?: NullableStringFieldUpdateOperationsInput | string | null
    question?: StringFieldUpdateOperationsInput | string
    answer?: StringFieldUpdateOperationsInput | string
    modelUsed?: StringFieldUpdateOperationsInput | string
    responseTime?: FloatFieldUpdateOperationsInput | number
    relevance?: NullableStringFieldUpdateOperationsInput | string | null
    relevanceExplanation?: NullableStringFieldUpdateOperationsInput | string | null
    promptTokens?: IntFieldUpdateOperationsInput | number
    completionTokens?: IntFieldUpdateOperationsInput | number
    totalTokens?: IntFieldUpdateOperationsInput | number
    cost?: FloatFieldUpdateOperationsInput | number
    feedback?: NullableIntFieldUpdateOperationsInput | number | null
    feedbackTimestamp?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    traceId?: NullableStringFieldUpdateOperationsInput | string | null
    usedFallback?: BoolFieldUpdateOperationsInput | boolean
    usedDeterministicFallback?: BoolFieldUpdateOperationsInput | boolean
    responseLanguage?: NullableStringFieldUpdateOperationsInput | string | null
    routeIntent?: NullableStringFieldUpdateOperationsInput | string | null
    warningCount?: IntFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ConversationUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: NullableStringFieldUpdateOperationsInput | string | null
    sessionId?: NullableStringFieldUpdateOperationsInput | string | null
    question?: StringFieldUpdateOperationsInput | string
    answer?: StringFieldUpdateOperationsInput | string
    modelUsed?: StringFieldUpdateOperationsInput | string
    responseTime?: FloatFieldUpdateOperationsInput | number
    relevance?: NullableStringFieldUpdateOperationsInput | string | null
    relevanceExplanation?: NullableStringFieldUpdateOperationsInput | string | null
    promptTokens?: IntFieldUpdateOperationsInput | number
    completionTokens?: IntFieldUpdateOperationsInput | number
    totalTokens?: IntFieldUpdateOperationsInput | number
    cost?: FloatFieldUpdateOperationsInput | number
    feedback?: NullableIntFieldUpdateOperationsInput | number | null
    feedbackTimestamp?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    traceId?: NullableStringFieldUpdateOperationsInput | string | null
    usedFallback?: BoolFieldUpdateOperationsInput | boolean
    usedDeterministicFallback?: BoolFieldUpdateOperationsInput | boolean
    responseLanguage?: NullableStringFieldUpdateOperationsInput | string | null
    routeIntent?: NullableStringFieldUpdateOperationsInput | string | null
    warningCount?: IntFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ConversationCreateManyInput = {
    id?: string
    userId?: string | null
    sessionId?: string | null
    question: string
    answer: string
    modelUsed: string
    responseTime: number
    relevance?: string | null
    relevanceExplanation?: string | null
    promptTokens: number
    completionTokens: number
    totalTokens: number
    cost?: number
    feedback?: number | null
    feedbackTimestamp?: Date | string | null
    traceId?: string | null
    usedFallback?: boolean
    usedDeterministicFallback?: boolean
    responseLanguage?: string | null
    routeIntent?: string | null
    warningCount?: number
    createdAt?: Date | string
  }

  export type ConversationUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: NullableStringFieldUpdateOperationsInput | string | null
    sessionId?: NullableStringFieldUpdateOperationsInput | string | null
    question?: StringFieldUpdateOperationsInput | string
    answer?: StringFieldUpdateOperationsInput | string
    modelUsed?: StringFieldUpdateOperationsInput | string
    responseTime?: FloatFieldUpdateOperationsInput | number
    relevance?: NullableStringFieldUpdateOperationsInput | string | null
    relevanceExplanation?: NullableStringFieldUpdateOperationsInput | string | null
    promptTokens?: IntFieldUpdateOperationsInput | number
    completionTokens?: IntFieldUpdateOperationsInput | number
    totalTokens?: IntFieldUpdateOperationsInput | number
    cost?: FloatFieldUpdateOperationsInput | number
    feedback?: NullableIntFieldUpdateOperationsInput | number | null
    feedbackTimestamp?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    traceId?: NullableStringFieldUpdateOperationsInput | string | null
    usedFallback?: BoolFieldUpdateOperationsInput | boolean
    usedDeterministicFallback?: BoolFieldUpdateOperationsInput | boolean
    responseLanguage?: NullableStringFieldUpdateOperationsInput | string | null
    routeIntent?: NullableStringFieldUpdateOperationsInput | string | null
    warningCount?: IntFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ConversationUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: NullableStringFieldUpdateOperationsInput | string | null
    sessionId?: NullableStringFieldUpdateOperationsInput | string | null
    question?: StringFieldUpdateOperationsInput | string
    answer?: StringFieldUpdateOperationsInput | string
    modelUsed?: StringFieldUpdateOperationsInput | string
    responseTime?: FloatFieldUpdateOperationsInput | number
    relevance?: NullableStringFieldUpdateOperationsInput | string | null
    relevanceExplanation?: NullableStringFieldUpdateOperationsInput | string | null
    promptTokens?: IntFieldUpdateOperationsInput | number
    completionTokens?: IntFieldUpdateOperationsInput | number
    totalTokens?: IntFieldUpdateOperationsInput | number
    cost?: FloatFieldUpdateOperationsInput | number
    feedback?: NullableIntFieldUpdateOperationsInput | number | null
    feedbackTimestamp?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    traceId?: NullableStringFieldUpdateOperationsInput | string | null
    usedFallback?: BoolFieldUpdateOperationsInput | boolean
    usedDeterministicFallback?: BoolFieldUpdateOperationsInput | boolean
    responseLanguage?: NullableStringFieldUpdateOperationsInput | string | null
    routeIntent?: NullableStringFieldUpdateOperationsInput | string | null
    warningCount?: IntFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ChatSessionCreateInput = {
    id?: string
    userId: string
    title: string
    lastMessageAt?: Date | string
    archivedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type ChatSessionUncheckedCreateInput = {
    id?: string
    userId: string
    title: string
    lastMessageAt?: Date | string
    archivedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type ChatSessionUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    lastMessageAt?: DateTimeFieldUpdateOperationsInput | Date | string
    archivedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ChatSessionUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    lastMessageAt?: DateTimeFieldUpdateOperationsInput | Date | string
    archivedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ChatSessionCreateManyInput = {
    id?: string
    userId: string
    title: string
    lastMessageAt?: Date | string
    archivedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type ChatSessionUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    lastMessageAt?: DateTimeFieldUpdateOperationsInput | Date | string
    archivedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ChatSessionUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    lastMessageAt?: DateTimeFieldUpdateOperationsInput | Date | string
    archivedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type UserMemoryCreateInput = {
    id?: string
    userId: string
    content: string
    category?: string | null
    createdAt?: Date | string
  }

  export type UserMemoryUncheckedCreateInput = {
    id?: string
    userId: string
    content: string
    category?: string | null
    createdAt?: Date | string
  }

  export type UserMemoryUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    content?: StringFieldUpdateOperationsInput | string
    category?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type UserMemoryUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    content?: StringFieldUpdateOperationsInput | string
    category?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type UserMemoryCreateManyInput = {
    id?: string
    userId: string
    content: string
    category?: string | null
    createdAt?: Date | string
  }

  export type UserMemoryUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    content?: StringFieldUpdateOperationsInput | string
    category?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type UserMemoryUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    content?: StringFieldUpdateOperationsInput | string
    category?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type WorkoutPlanCreateInput = {
    id?: string
    userId: string
    name: string
    description?: string | null
    goal: string
    duration: number
    daysPerWeek: number
    plan: JsonNullValueInput | InputJsonValue
    status?: $Enums.PlanStatus
    version?: number
    jobId?: string | null
    failReason?: string | null
    ptUserId?: string | null
    ptName?: string | null
    clientName?: string | null
    ptReviewStatus?: $Enums.PtReviewStatus | null
    ptNote?: string | null
    ptReviewedAt?: Date | string | null
    archivedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    publishedListings?: PublishedPlanCreateNestedManyWithoutSourcePlanInput
  }

  export type WorkoutPlanUncheckedCreateInput = {
    id?: string
    userId: string
    name: string
    description?: string | null
    goal: string
    duration: number
    daysPerWeek: number
    plan: JsonNullValueInput | InputJsonValue
    status?: $Enums.PlanStatus
    version?: number
    jobId?: string | null
    failReason?: string | null
    ptUserId?: string | null
    ptName?: string | null
    clientName?: string | null
    ptReviewStatus?: $Enums.PtReviewStatus | null
    ptNote?: string | null
    ptReviewedAt?: Date | string | null
    archivedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    publishedListings?: PublishedPlanUncheckedCreateNestedManyWithoutSourcePlanInput
  }

  export type WorkoutPlanUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    goal?: StringFieldUpdateOperationsInput | string
    duration?: IntFieldUpdateOperationsInput | number
    daysPerWeek?: IntFieldUpdateOperationsInput | number
    plan?: JsonNullValueInput | InputJsonValue
    status?: EnumPlanStatusFieldUpdateOperationsInput | $Enums.PlanStatus
    version?: IntFieldUpdateOperationsInput | number
    jobId?: NullableStringFieldUpdateOperationsInput | string | null
    failReason?: NullableStringFieldUpdateOperationsInput | string | null
    ptUserId?: NullableStringFieldUpdateOperationsInput | string | null
    ptName?: NullableStringFieldUpdateOperationsInput | string | null
    clientName?: NullableStringFieldUpdateOperationsInput | string | null
    ptReviewStatus?: NullableEnumPtReviewStatusFieldUpdateOperationsInput | $Enums.PtReviewStatus | null
    ptNote?: NullableStringFieldUpdateOperationsInput | string | null
    ptReviewedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    archivedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    publishedListings?: PublishedPlanUpdateManyWithoutSourcePlanNestedInput
  }

  export type WorkoutPlanUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    goal?: StringFieldUpdateOperationsInput | string
    duration?: IntFieldUpdateOperationsInput | number
    daysPerWeek?: IntFieldUpdateOperationsInput | number
    plan?: JsonNullValueInput | InputJsonValue
    status?: EnumPlanStatusFieldUpdateOperationsInput | $Enums.PlanStatus
    version?: IntFieldUpdateOperationsInput | number
    jobId?: NullableStringFieldUpdateOperationsInput | string | null
    failReason?: NullableStringFieldUpdateOperationsInput | string | null
    ptUserId?: NullableStringFieldUpdateOperationsInput | string | null
    ptName?: NullableStringFieldUpdateOperationsInput | string | null
    clientName?: NullableStringFieldUpdateOperationsInput | string | null
    ptReviewStatus?: NullableEnumPtReviewStatusFieldUpdateOperationsInput | $Enums.PtReviewStatus | null
    ptNote?: NullableStringFieldUpdateOperationsInput | string | null
    ptReviewedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    archivedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    publishedListings?: PublishedPlanUncheckedUpdateManyWithoutSourcePlanNestedInput
  }

  export type WorkoutPlanCreateManyInput = {
    id?: string
    userId: string
    name: string
    description?: string | null
    goal: string
    duration: number
    daysPerWeek: number
    plan: JsonNullValueInput | InputJsonValue
    status?: $Enums.PlanStatus
    version?: number
    jobId?: string | null
    failReason?: string | null
    ptUserId?: string | null
    ptName?: string | null
    clientName?: string | null
    ptReviewStatus?: $Enums.PtReviewStatus | null
    ptNote?: string | null
    ptReviewedAt?: Date | string | null
    archivedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type WorkoutPlanUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    goal?: StringFieldUpdateOperationsInput | string
    duration?: IntFieldUpdateOperationsInput | number
    daysPerWeek?: IntFieldUpdateOperationsInput | number
    plan?: JsonNullValueInput | InputJsonValue
    status?: EnumPlanStatusFieldUpdateOperationsInput | $Enums.PlanStatus
    version?: IntFieldUpdateOperationsInput | number
    jobId?: NullableStringFieldUpdateOperationsInput | string | null
    failReason?: NullableStringFieldUpdateOperationsInput | string | null
    ptUserId?: NullableStringFieldUpdateOperationsInput | string | null
    ptName?: NullableStringFieldUpdateOperationsInput | string | null
    clientName?: NullableStringFieldUpdateOperationsInput | string | null
    ptReviewStatus?: NullableEnumPtReviewStatusFieldUpdateOperationsInput | $Enums.PtReviewStatus | null
    ptNote?: NullableStringFieldUpdateOperationsInput | string | null
    ptReviewedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    archivedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type WorkoutPlanUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    goal?: StringFieldUpdateOperationsInput | string
    duration?: IntFieldUpdateOperationsInput | number
    daysPerWeek?: IntFieldUpdateOperationsInput | number
    plan?: JsonNullValueInput | InputJsonValue
    status?: EnumPlanStatusFieldUpdateOperationsInput | $Enums.PlanStatus
    version?: IntFieldUpdateOperationsInput | number
    jobId?: NullableStringFieldUpdateOperationsInput | string | null
    failReason?: NullableStringFieldUpdateOperationsInput | string | null
    ptUserId?: NullableStringFieldUpdateOperationsInput | string | null
    ptName?: NullableStringFieldUpdateOperationsInput | string | null
    clientName?: NullableStringFieldUpdateOperationsInput | string | null
    ptReviewStatus?: NullableEnumPtReviewStatusFieldUpdateOperationsInput | $Enums.PtReviewStatus | null
    ptNote?: NullableStringFieldUpdateOperationsInput | string | null
    ptReviewedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    archivedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PublishedPlanCreateInput = {
    id?: string
    publisherId: string
    title: string
    description?: string | null
    goal: string
    moderationStatus?: $Enums.PublishModerationStatus
    moderationNote?: string | null
    avgRating?: number
    ratingCount?: number
    publishedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    sourcePlan: WorkoutPlanCreateNestedOneWithoutPublishedListingsInput
    reviews?: PlanReviewCreateNestedManyWithoutPublishedPlanInput
    packages?: TrainingPackageCreateNestedManyWithoutPublishedPlanInput
  }

  export type PublishedPlanUncheckedCreateInput = {
    id?: string
    sourcePlanId: string
    publisherId: string
    title: string
    description?: string | null
    goal: string
    moderationStatus?: $Enums.PublishModerationStatus
    moderationNote?: string | null
    avgRating?: number
    ratingCount?: number
    publishedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    reviews?: PlanReviewUncheckedCreateNestedManyWithoutPublishedPlanInput
    packages?: TrainingPackageUncheckedCreateNestedManyWithoutPublishedPlanInput
  }

  export type PublishedPlanUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    publisherId?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    goal?: StringFieldUpdateOperationsInput | string
    moderationStatus?: EnumPublishModerationStatusFieldUpdateOperationsInput | $Enums.PublishModerationStatus
    moderationNote?: NullableStringFieldUpdateOperationsInput | string | null
    avgRating?: FloatFieldUpdateOperationsInput | number
    ratingCount?: IntFieldUpdateOperationsInput | number
    publishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    sourcePlan?: WorkoutPlanUpdateOneRequiredWithoutPublishedListingsNestedInput
    reviews?: PlanReviewUpdateManyWithoutPublishedPlanNestedInput
    packages?: TrainingPackageUpdateManyWithoutPublishedPlanNestedInput
  }

  export type PublishedPlanUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    sourcePlanId?: StringFieldUpdateOperationsInput | string
    publisherId?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    goal?: StringFieldUpdateOperationsInput | string
    moderationStatus?: EnumPublishModerationStatusFieldUpdateOperationsInput | $Enums.PublishModerationStatus
    moderationNote?: NullableStringFieldUpdateOperationsInput | string | null
    avgRating?: FloatFieldUpdateOperationsInput | number
    ratingCount?: IntFieldUpdateOperationsInput | number
    publishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    reviews?: PlanReviewUncheckedUpdateManyWithoutPublishedPlanNestedInput
    packages?: TrainingPackageUncheckedUpdateManyWithoutPublishedPlanNestedInput
  }

  export type PublishedPlanCreateManyInput = {
    id?: string
    sourcePlanId: string
    publisherId: string
    title: string
    description?: string | null
    goal: string
    moderationStatus?: $Enums.PublishModerationStatus
    moderationNote?: string | null
    avgRating?: number
    ratingCount?: number
    publishedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type PublishedPlanUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    publisherId?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    goal?: StringFieldUpdateOperationsInput | string
    moderationStatus?: EnumPublishModerationStatusFieldUpdateOperationsInput | $Enums.PublishModerationStatus
    moderationNote?: NullableStringFieldUpdateOperationsInput | string | null
    avgRating?: FloatFieldUpdateOperationsInput | number
    ratingCount?: IntFieldUpdateOperationsInput | number
    publishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PublishedPlanUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    sourcePlanId?: StringFieldUpdateOperationsInput | string
    publisherId?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    goal?: StringFieldUpdateOperationsInput | string
    moderationStatus?: EnumPublishModerationStatusFieldUpdateOperationsInput | $Enums.PublishModerationStatus
    moderationNote?: NullableStringFieldUpdateOperationsInput | string | null
    avgRating?: FloatFieldUpdateOperationsInput | number
    ratingCount?: IntFieldUpdateOperationsInput | number
    publishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PlanReviewCreateInput = {
    id?: string
    reviewerId: string
    rating: number
    comment?: string | null
    createdAt?: Date | string
    publishedPlan: PublishedPlanCreateNestedOneWithoutReviewsInput
  }

  export type PlanReviewUncheckedCreateInput = {
    id?: string
    publishedPlanId: string
    reviewerId: string
    rating: number
    comment?: string | null
    createdAt?: Date | string
  }

  export type PlanReviewUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    reviewerId?: StringFieldUpdateOperationsInput | string
    rating?: IntFieldUpdateOperationsInput | number
    comment?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    publishedPlan?: PublishedPlanUpdateOneRequiredWithoutReviewsNestedInput
  }

  export type PlanReviewUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    publishedPlanId?: StringFieldUpdateOperationsInput | string
    reviewerId?: StringFieldUpdateOperationsInput | string
    rating?: IntFieldUpdateOperationsInput | number
    comment?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PlanReviewCreateManyInput = {
    id?: string
    publishedPlanId: string
    reviewerId: string
    rating: number
    comment?: string | null
    createdAt?: Date | string
  }

  export type PlanReviewUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    reviewerId?: StringFieldUpdateOperationsInput | string
    rating?: IntFieldUpdateOperationsInput | number
    comment?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PlanReviewUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    publishedPlanId?: StringFieldUpdateOperationsInput | string
    reviewerId?: StringFieldUpdateOperationsInput | string
    rating?: IntFieldUpdateOperationsInput | number
    comment?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TrainingPackageCreateInput = {
    id?: string
    sellerId: string
    name: string
    description?: string | null
    price: number
    durationWeeks?: number | null
    status?: $Enums.TrainingPackageStatus
    createdAt?: Date | string
    updatedAt?: Date | string
    publishedPlan: PublishedPlanCreateNestedOneWithoutPackagesInput
    purchases?: TrainingPackagePurchaseCreateNestedManyWithoutPackageInput
  }

  export type TrainingPackageUncheckedCreateInput = {
    id?: string
    sellerId: string
    publishedPlanId: string
    name: string
    description?: string | null
    price: number
    durationWeeks?: number | null
    status?: $Enums.TrainingPackageStatus
    createdAt?: Date | string
    updatedAt?: Date | string
    purchases?: TrainingPackagePurchaseUncheckedCreateNestedManyWithoutPackageInput
  }

  export type TrainingPackageUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    sellerId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    price?: FloatFieldUpdateOperationsInput | number
    durationWeeks?: NullableIntFieldUpdateOperationsInput | number | null
    status?: EnumTrainingPackageStatusFieldUpdateOperationsInput | $Enums.TrainingPackageStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    publishedPlan?: PublishedPlanUpdateOneRequiredWithoutPackagesNestedInput
    purchases?: TrainingPackagePurchaseUpdateManyWithoutPackageNestedInput
  }

  export type TrainingPackageUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    sellerId?: StringFieldUpdateOperationsInput | string
    publishedPlanId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    price?: FloatFieldUpdateOperationsInput | number
    durationWeeks?: NullableIntFieldUpdateOperationsInput | number | null
    status?: EnumTrainingPackageStatusFieldUpdateOperationsInput | $Enums.TrainingPackageStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    purchases?: TrainingPackagePurchaseUncheckedUpdateManyWithoutPackageNestedInput
  }

  export type TrainingPackageCreateManyInput = {
    id?: string
    sellerId: string
    publishedPlanId: string
    name: string
    description?: string | null
    price: number
    durationWeeks?: number | null
    status?: $Enums.TrainingPackageStatus
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type TrainingPackageUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    sellerId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    price?: FloatFieldUpdateOperationsInput | number
    durationWeeks?: NullableIntFieldUpdateOperationsInput | number | null
    status?: EnumTrainingPackageStatusFieldUpdateOperationsInput | $Enums.TrainingPackageStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TrainingPackageUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    sellerId?: StringFieldUpdateOperationsInput | string
    publishedPlanId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    price?: FloatFieldUpdateOperationsInput | number
    durationWeeks?: NullableIntFieldUpdateOperationsInput | number | null
    status?: EnumTrainingPackageStatusFieldUpdateOperationsInput | $Enums.TrainingPackageStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TrainingPackagePurchaseCreateInput = {
    id?: string
    buyerId: string
    priceAtPurchase: number
    paymentTransactionId?: string | null
    status?: $Enums.TrainingPackagePurchaseStatus
    purchasedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    package: TrainingPackageCreateNestedOneWithoutPurchasesInput
  }

  export type TrainingPackagePurchaseUncheckedCreateInput = {
    id?: string
    packageId: string
    buyerId: string
    priceAtPurchase: number
    paymentTransactionId?: string | null
    status?: $Enums.TrainingPackagePurchaseStatus
    purchasedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type TrainingPackagePurchaseUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    buyerId?: StringFieldUpdateOperationsInput | string
    priceAtPurchase?: FloatFieldUpdateOperationsInput | number
    paymentTransactionId?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumTrainingPackagePurchaseStatusFieldUpdateOperationsInput | $Enums.TrainingPackagePurchaseStatus
    purchasedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    package?: TrainingPackageUpdateOneRequiredWithoutPurchasesNestedInput
  }

  export type TrainingPackagePurchaseUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    packageId?: StringFieldUpdateOperationsInput | string
    buyerId?: StringFieldUpdateOperationsInput | string
    priceAtPurchase?: FloatFieldUpdateOperationsInput | number
    paymentTransactionId?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumTrainingPackagePurchaseStatusFieldUpdateOperationsInput | $Enums.TrainingPackagePurchaseStatus
    purchasedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TrainingPackagePurchaseCreateManyInput = {
    id?: string
    packageId: string
    buyerId: string
    priceAtPurchase: number
    paymentTransactionId?: string | null
    status?: $Enums.TrainingPackagePurchaseStatus
    purchasedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type TrainingPackagePurchaseUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    buyerId?: StringFieldUpdateOperationsInput | string
    priceAtPurchase?: FloatFieldUpdateOperationsInput | number
    paymentTransactionId?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumTrainingPackagePurchaseStatusFieldUpdateOperationsInput | $Enums.TrainingPackagePurchaseStatus
    purchasedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TrainingPackagePurchaseUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    packageId?: StringFieldUpdateOperationsInput | string
    buyerId?: StringFieldUpdateOperationsInput | string
    priceAtPurchase?: FloatFieldUpdateOperationsInput | number
    paymentTransactionId?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumTrainingPackagePurchaseStatusFieldUpdateOperationsInput | $Enums.TrainingPackagePurchaseStatus
    purchasedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type NutritionPlanCreateInput = {
    id?: string
    userId: string
    name: string
    goal: string
    durationWeeks: number
    mealsPerDay: number
    plan: JsonNullValueInput | InputJsonValue
    status?: $Enums.PlanStatus
    jobId?: string | null
    failReason?: string | null
    archivedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type NutritionPlanUncheckedCreateInput = {
    id?: string
    userId: string
    name: string
    goal: string
    durationWeeks: number
    mealsPerDay: number
    plan: JsonNullValueInput | InputJsonValue
    status?: $Enums.PlanStatus
    jobId?: string | null
    failReason?: string | null
    archivedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type NutritionPlanUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    goal?: StringFieldUpdateOperationsInput | string
    durationWeeks?: IntFieldUpdateOperationsInput | number
    mealsPerDay?: IntFieldUpdateOperationsInput | number
    plan?: JsonNullValueInput | InputJsonValue
    status?: EnumPlanStatusFieldUpdateOperationsInput | $Enums.PlanStatus
    jobId?: NullableStringFieldUpdateOperationsInput | string | null
    failReason?: NullableStringFieldUpdateOperationsInput | string | null
    archivedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type NutritionPlanUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    goal?: StringFieldUpdateOperationsInput | string
    durationWeeks?: IntFieldUpdateOperationsInput | number
    mealsPerDay?: IntFieldUpdateOperationsInput | number
    plan?: JsonNullValueInput | InputJsonValue
    status?: EnumPlanStatusFieldUpdateOperationsInput | $Enums.PlanStatus
    jobId?: NullableStringFieldUpdateOperationsInput | string | null
    failReason?: NullableStringFieldUpdateOperationsInput | string | null
    archivedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type NutritionPlanCreateManyInput = {
    id?: string
    userId: string
    name: string
    goal: string
    durationWeeks: number
    mealsPerDay: number
    plan: JsonNullValueInput | InputJsonValue
    status?: $Enums.PlanStatus
    jobId?: string | null
    failReason?: string | null
    archivedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type NutritionPlanUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    goal?: StringFieldUpdateOperationsInput | string
    durationWeeks?: IntFieldUpdateOperationsInput | number
    mealsPerDay?: IntFieldUpdateOperationsInput | number
    plan?: JsonNullValueInput | InputJsonValue
    status?: EnumPlanStatusFieldUpdateOperationsInput | $Enums.PlanStatus
    jobId?: NullableStringFieldUpdateOperationsInput | string | null
    failReason?: NullableStringFieldUpdateOperationsInput | string | null
    archivedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type NutritionPlanUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    goal?: StringFieldUpdateOperationsInput | string
    durationWeeks?: IntFieldUpdateOperationsInput | number
    mealsPerDay?: IntFieldUpdateOperationsInput | number
    plan?: JsonNullValueInput | InputJsonValue
    status?: EnumPlanStatusFieldUpdateOperationsInput | $Enums.PlanStatus
    jobId?: NullableStringFieldUpdateOperationsInput | string | null
    failReason?: NullableStringFieldUpdateOperationsInput | string | null
    archivedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type KnowledgeSourceCreateInput = {
    id?: string
    name: string
    baseUrl: string
    sourceType: $Enums.KnowledgeSourceType
    trustTier?: number
    crawlCron?: string
    isActive?: boolean
    lastCrawledAt?: Date | string | null
    createdAt?: Date | string
    documents?: KnowledgeDocumentCreateNestedManyWithoutSourceInput
  }

  export type KnowledgeSourceUncheckedCreateInput = {
    id?: string
    name: string
    baseUrl: string
    sourceType: $Enums.KnowledgeSourceType
    trustTier?: number
    crawlCron?: string
    isActive?: boolean
    lastCrawledAt?: Date | string | null
    createdAt?: Date | string
    documents?: KnowledgeDocumentUncheckedCreateNestedManyWithoutSourceInput
  }

  export type KnowledgeSourceUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    baseUrl?: StringFieldUpdateOperationsInput | string
    sourceType?: EnumKnowledgeSourceTypeFieldUpdateOperationsInput | $Enums.KnowledgeSourceType
    trustTier?: IntFieldUpdateOperationsInput | number
    crawlCron?: StringFieldUpdateOperationsInput | string
    isActive?: BoolFieldUpdateOperationsInput | boolean
    lastCrawledAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    documents?: KnowledgeDocumentUpdateManyWithoutSourceNestedInput
  }

  export type KnowledgeSourceUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    baseUrl?: StringFieldUpdateOperationsInput | string
    sourceType?: EnumKnowledgeSourceTypeFieldUpdateOperationsInput | $Enums.KnowledgeSourceType
    trustTier?: IntFieldUpdateOperationsInput | number
    crawlCron?: StringFieldUpdateOperationsInput | string
    isActive?: BoolFieldUpdateOperationsInput | boolean
    lastCrawledAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    documents?: KnowledgeDocumentUncheckedUpdateManyWithoutSourceNestedInput
  }

  export type KnowledgeSourceCreateManyInput = {
    id?: string
    name: string
    baseUrl: string
    sourceType: $Enums.KnowledgeSourceType
    trustTier?: number
    crawlCron?: string
    isActive?: boolean
    lastCrawledAt?: Date | string | null
    createdAt?: Date | string
  }

  export type KnowledgeSourceUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    baseUrl?: StringFieldUpdateOperationsInput | string
    sourceType?: EnumKnowledgeSourceTypeFieldUpdateOperationsInput | $Enums.KnowledgeSourceType
    trustTier?: IntFieldUpdateOperationsInput | number
    crawlCron?: StringFieldUpdateOperationsInput | string
    isActive?: BoolFieldUpdateOperationsInput | boolean
    lastCrawledAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type KnowledgeSourceUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    baseUrl?: StringFieldUpdateOperationsInput | string
    sourceType?: EnumKnowledgeSourceTypeFieldUpdateOperationsInput | $Enums.KnowledgeSourceType
    trustTier?: IntFieldUpdateOperationsInput | number
    crawlCron?: StringFieldUpdateOperationsInput | string
    isActive?: BoolFieldUpdateOperationsInput | boolean
    lastCrawledAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type KnowledgeDocumentCreateInput = {
    id?: string
    url: string
    title?: string | null
    author?: string | null
    language?: string | null
    contentHash: string
    rawObjectKey?: string | null
    cleanText?: string | null
    topic?: $Enums.KnowledgeDocumentTopic | null
    trustScore?: Decimal | DecimalJsLike | number | string | null
    qualityScore?: Decimal | DecimalJsLike | number | string | null
    safetyFlag?: boolean
    status?: $Enums.KnowledgeDocumentStatus
    rejectionReason?: string | null
    publishedAt?: Date | string | null
    crawledAt?: Date | string
    processedAt?: Date | string | null
    source: KnowledgeSourceCreateNestedOneWithoutDocumentsInput
    chunks?: KnowledgeChunkCreateNestedManyWithoutDocumentInput
    reviewItems?: KnowledgeReviewItemCreateNestedManyWithoutDocumentInput
  }

  export type KnowledgeDocumentUncheckedCreateInput = {
    id?: string
    sourceId: string
    url: string
    title?: string | null
    author?: string | null
    language?: string | null
    contentHash: string
    rawObjectKey?: string | null
    cleanText?: string | null
    topic?: $Enums.KnowledgeDocumentTopic | null
    trustScore?: Decimal | DecimalJsLike | number | string | null
    qualityScore?: Decimal | DecimalJsLike | number | string | null
    safetyFlag?: boolean
    status?: $Enums.KnowledgeDocumentStatus
    rejectionReason?: string | null
    publishedAt?: Date | string | null
    crawledAt?: Date | string
    processedAt?: Date | string | null
    chunks?: KnowledgeChunkUncheckedCreateNestedManyWithoutDocumentInput
    reviewItems?: KnowledgeReviewItemUncheckedCreateNestedManyWithoutDocumentInput
  }

  export type KnowledgeDocumentUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    url?: StringFieldUpdateOperationsInput | string
    title?: NullableStringFieldUpdateOperationsInput | string | null
    author?: NullableStringFieldUpdateOperationsInput | string | null
    language?: NullableStringFieldUpdateOperationsInput | string | null
    contentHash?: StringFieldUpdateOperationsInput | string
    rawObjectKey?: NullableStringFieldUpdateOperationsInput | string | null
    cleanText?: NullableStringFieldUpdateOperationsInput | string | null
    topic?: NullableEnumKnowledgeDocumentTopicFieldUpdateOperationsInput | $Enums.KnowledgeDocumentTopic | null
    trustScore?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    qualityScore?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    safetyFlag?: BoolFieldUpdateOperationsInput | boolean
    status?: EnumKnowledgeDocumentStatusFieldUpdateOperationsInput | $Enums.KnowledgeDocumentStatus
    rejectionReason?: NullableStringFieldUpdateOperationsInput | string | null
    publishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    crawledAt?: DateTimeFieldUpdateOperationsInput | Date | string
    processedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    source?: KnowledgeSourceUpdateOneRequiredWithoutDocumentsNestedInput
    chunks?: KnowledgeChunkUpdateManyWithoutDocumentNestedInput
    reviewItems?: KnowledgeReviewItemUpdateManyWithoutDocumentNestedInput
  }

  export type KnowledgeDocumentUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    sourceId?: StringFieldUpdateOperationsInput | string
    url?: StringFieldUpdateOperationsInput | string
    title?: NullableStringFieldUpdateOperationsInput | string | null
    author?: NullableStringFieldUpdateOperationsInput | string | null
    language?: NullableStringFieldUpdateOperationsInput | string | null
    contentHash?: StringFieldUpdateOperationsInput | string
    rawObjectKey?: NullableStringFieldUpdateOperationsInput | string | null
    cleanText?: NullableStringFieldUpdateOperationsInput | string | null
    topic?: NullableEnumKnowledgeDocumentTopicFieldUpdateOperationsInput | $Enums.KnowledgeDocumentTopic | null
    trustScore?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    qualityScore?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    safetyFlag?: BoolFieldUpdateOperationsInput | boolean
    status?: EnumKnowledgeDocumentStatusFieldUpdateOperationsInput | $Enums.KnowledgeDocumentStatus
    rejectionReason?: NullableStringFieldUpdateOperationsInput | string | null
    publishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    crawledAt?: DateTimeFieldUpdateOperationsInput | Date | string
    processedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    chunks?: KnowledgeChunkUncheckedUpdateManyWithoutDocumentNestedInput
    reviewItems?: KnowledgeReviewItemUncheckedUpdateManyWithoutDocumentNestedInput
  }

  export type KnowledgeDocumentCreateManyInput = {
    id?: string
    sourceId: string
    url: string
    title?: string | null
    author?: string | null
    language?: string | null
    contentHash: string
    rawObjectKey?: string | null
    cleanText?: string | null
    topic?: $Enums.KnowledgeDocumentTopic | null
    trustScore?: Decimal | DecimalJsLike | number | string | null
    qualityScore?: Decimal | DecimalJsLike | number | string | null
    safetyFlag?: boolean
    status?: $Enums.KnowledgeDocumentStatus
    rejectionReason?: string | null
    publishedAt?: Date | string | null
    crawledAt?: Date | string
    processedAt?: Date | string | null
  }

  export type KnowledgeDocumentUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    url?: StringFieldUpdateOperationsInput | string
    title?: NullableStringFieldUpdateOperationsInput | string | null
    author?: NullableStringFieldUpdateOperationsInput | string | null
    language?: NullableStringFieldUpdateOperationsInput | string | null
    contentHash?: StringFieldUpdateOperationsInput | string
    rawObjectKey?: NullableStringFieldUpdateOperationsInput | string | null
    cleanText?: NullableStringFieldUpdateOperationsInput | string | null
    topic?: NullableEnumKnowledgeDocumentTopicFieldUpdateOperationsInput | $Enums.KnowledgeDocumentTopic | null
    trustScore?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    qualityScore?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    safetyFlag?: BoolFieldUpdateOperationsInput | boolean
    status?: EnumKnowledgeDocumentStatusFieldUpdateOperationsInput | $Enums.KnowledgeDocumentStatus
    rejectionReason?: NullableStringFieldUpdateOperationsInput | string | null
    publishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    crawledAt?: DateTimeFieldUpdateOperationsInput | Date | string
    processedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
  }

  export type KnowledgeDocumentUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    sourceId?: StringFieldUpdateOperationsInput | string
    url?: StringFieldUpdateOperationsInput | string
    title?: NullableStringFieldUpdateOperationsInput | string | null
    author?: NullableStringFieldUpdateOperationsInput | string | null
    language?: NullableStringFieldUpdateOperationsInput | string | null
    contentHash?: StringFieldUpdateOperationsInput | string
    rawObjectKey?: NullableStringFieldUpdateOperationsInput | string | null
    cleanText?: NullableStringFieldUpdateOperationsInput | string | null
    topic?: NullableEnumKnowledgeDocumentTopicFieldUpdateOperationsInput | $Enums.KnowledgeDocumentTopic | null
    trustScore?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    qualityScore?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    safetyFlag?: BoolFieldUpdateOperationsInput | boolean
    status?: EnumKnowledgeDocumentStatusFieldUpdateOperationsInput | $Enums.KnowledgeDocumentStatus
    rejectionReason?: NullableStringFieldUpdateOperationsInput | string | null
    publishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    crawledAt?: DateTimeFieldUpdateOperationsInput | Date | string
    processedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
  }

  export type KnowledgeChunkCreateInput = {
    id?: string
    chunkIndex: number
    text: string
    tokenCount?: number | null
    vectorId: string
    embeddedAt?: Date | string
    document: KnowledgeDocumentCreateNestedOneWithoutChunksInput
  }

  export type KnowledgeChunkUncheckedCreateInput = {
    id?: string
    documentId: string
    chunkIndex: number
    text: string
    tokenCount?: number | null
    vectorId: string
    embeddedAt?: Date | string
  }

  export type KnowledgeChunkUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    chunkIndex?: IntFieldUpdateOperationsInput | number
    text?: StringFieldUpdateOperationsInput | string
    tokenCount?: NullableIntFieldUpdateOperationsInput | number | null
    vectorId?: StringFieldUpdateOperationsInput | string
    embeddedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    document?: KnowledgeDocumentUpdateOneRequiredWithoutChunksNestedInput
  }

  export type KnowledgeChunkUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    documentId?: StringFieldUpdateOperationsInput | string
    chunkIndex?: IntFieldUpdateOperationsInput | number
    text?: StringFieldUpdateOperationsInput | string
    tokenCount?: NullableIntFieldUpdateOperationsInput | number | null
    vectorId?: StringFieldUpdateOperationsInput | string
    embeddedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type KnowledgeChunkCreateManyInput = {
    id?: string
    documentId: string
    chunkIndex: number
    text: string
    tokenCount?: number | null
    vectorId: string
    embeddedAt?: Date | string
  }

  export type KnowledgeChunkUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    chunkIndex?: IntFieldUpdateOperationsInput | number
    text?: StringFieldUpdateOperationsInput | string
    tokenCount?: NullableIntFieldUpdateOperationsInput | number | null
    vectorId?: StringFieldUpdateOperationsInput | string
    embeddedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type KnowledgeChunkUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    documentId?: StringFieldUpdateOperationsInput | string
    chunkIndex?: IntFieldUpdateOperationsInput | number
    text?: StringFieldUpdateOperationsInput | string
    tokenCount?: NullableIntFieldUpdateOperationsInput | number | null
    vectorId?: StringFieldUpdateOperationsInput | string
    embeddedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type KnowledgePipelineRunCreateInput = {
    id?: string
    runType?: string
    startedAt?: Date | string
    finishedAt?: Date | string | null
    docsCrawled?: number
    docsAccepted?: number
    docsRejected?: number
    docsReview?: number
    status?: $Enums.KnowledgePipelineRunStatus
  }

  export type KnowledgePipelineRunUncheckedCreateInput = {
    id?: string
    runType?: string
    startedAt?: Date | string
    finishedAt?: Date | string | null
    docsCrawled?: number
    docsAccepted?: number
    docsRejected?: number
    docsReview?: number
    status?: $Enums.KnowledgePipelineRunStatus
  }

  export type KnowledgePipelineRunUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    runType?: StringFieldUpdateOperationsInput | string
    startedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    finishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    docsCrawled?: IntFieldUpdateOperationsInput | number
    docsAccepted?: IntFieldUpdateOperationsInput | number
    docsRejected?: IntFieldUpdateOperationsInput | number
    docsReview?: IntFieldUpdateOperationsInput | number
    status?: EnumKnowledgePipelineRunStatusFieldUpdateOperationsInput | $Enums.KnowledgePipelineRunStatus
  }

  export type KnowledgePipelineRunUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    runType?: StringFieldUpdateOperationsInput | string
    startedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    finishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    docsCrawled?: IntFieldUpdateOperationsInput | number
    docsAccepted?: IntFieldUpdateOperationsInput | number
    docsRejected?: IntFieldUpdateOperationsInput | number
    docsReview?: IntFieldUpdateOperationsInput | number
    status?: EnumKnowledgePipelineRunStatusFieldUpdateOperationsInput | $Enums.KnowledgePipelineRunStatus
  }

  export type KnowledgePipelineRunCreateManyInput = {
    id?: string
    runType?: string
    startedAt?: Date | string
    finishedAt?: Date | string | null
    docsCrawled?: number
    docsAccepted?: number
    docsRejected?: number
    docsReview?: number
    status?: $Enums.KnowledgePipelineRunStatus
  }

  export type KnowledgePipelineRunUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    runType?: StringFieldUpdateOperationsInput | string
    startedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    finishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    docsCrawled?: IntFieldUpdateOperationsInput | number
    docsAccepted?: IntFieldUpdateOperationsInput | number
    docsRejected?: IntFieldUpdateOperationsInput | number
    docsReview?: IntFieldUpdateOperationsInput | number
    status?: EnumKnowledgePipelineRunStatusFieldUpdateOperationsInput | $Enums.KnowledgePipelineRunStatus
  }

  export type KnowledgePipelineRunUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    runType?: StringFieldUpdateOperationsInput | string
    startedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    finishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    docsCrawled?: IntFieldUpdateOperationsInput | number
    docsAccepted?: IntFieldUpdateOperationsInput | number
    docsRejected?: IntFieldUpdateOperationsInput | number
    docsReview?: IntFieldUpdateOperationsInput | number
    status?: EnumKnowledgePipelineRunStatusFieldUpdateOperationsInput | $Enums.KnowledgePipelineRunStatus
  }

  export type KnowledgeReviewItemCreateInput = {
    id?: string
    reason?: string | null
    status?: $Enums.KnowledgeReviewStatus
    reviewedBy?: string | null
    reviewedAt?: Date | string | null
    document: KnowledgeDocumentCreateNestedOneWithoutReviewItemsInput
  }

  export type KnowledgeReviewItemUncheckedCreateInput = {
    id?: string
    documentId: string
    reason?: string | null
    status?: $Enums.KnowledgeReviewStatus
    reviewedBy?: string | null
    reviewedAt?: Date | string | null
  }

  export type KnowledgeReviewItemUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    reason?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumKnowledgeReviewStatusFieldUpdateOperationsInput | $Enums.KnowledgeReviewStatus
    reviewedBy?: NullableStringFieldUpdateOperationsInput | string | null
    reviewedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    document?: KnowledgeDocumentUpdateOneRequiredWithoutReviewItemsNestedInput
  }

  export type KnowledgeReviewItemUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    documentId?: StringFieldUpdateOperationsInput | string
    reason?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumKnowledgeReviewStatusFieldUpdateOperationsInput | $Enums.KnowledgeReviewStatus
    reviewedBy?: NullableStringFieldUpdateOperationsInput | string | null
    reviewedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
  }

  export type KnowledgeReviewItemCreateManyInput = {
    id?: string
    documentId: string
    reason?: string | null
    status?: $Enums.KnowledgeReviewStatus
    reviewedBy?: string | null
    reviewedAt?: Date | string | null
  }

  export type KnowledgeReviewItemUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    reason?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumKnowledgeReviewStatusFieldUpdateOperationsInput | $Enums.KnowledgeReviewStatus
    reviewedBy?: NullableStringFieldUpdateOperationsInput | string | null
    reviewedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
  }

  export type KnowledgeReviewItemUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    documentId?: StringFieldUpdateOperationsInput | string
    reason?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumKnowledgeReviewStatusFieldUpdateOperationsInput | $Enums.KnowledgeReviewStatus
    reviewedBy?: NullableStringFieldUpdateOperationsInput | string | null
    reviewedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
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

  export type SortOrderInput = {
    sort: SortOrder
    nulls?: NullsOrder
  }

  export type ConversationCountOrderByAggregateInput = {
    id?: SortOrder
    userId?: SortOrder
    sessionId?: SortOrder
    question?: SortOrder
    answer?: SortOrder
    modelUsed?: SortOrder
    responseTime?: SortOrder
    relevance?: SortOrder
    relevanceExplanation?: SortOrder
    promptTokens?: SortOrder
    completionTokens?: SortOrder
    totalTokens?: SortOrder
    cost?: SortOrder
    feedback?: SortOrder
    feedbackTimestamp?: SortOrder
    traceId?: SortOrder
    usedFallback?: SortOrder
    usedDeterministicFallback?: SortOrder
    responseLanguage?: SortOrder
    routeIntent?: SortOrder
    warningCount?: SortOrder
    createdAt?: SortOrder
  }

  export type ConversationAvgOrderByAggregateInput = {
    responseTime?: SortOrder
    promptTokens?: SortOrder
    completionTokens?: SortOrder
    totalTokens?: SortOrder
    cost?: SortOrder
    feedback?: SortOrder
    warningCount?: SortOrder
  }

  export type ConversationMaxOrderByAggregateInput = {
    id?: SortOrder
    userId?: SortOrder
    sessionId?: SortOrder
    question?: SortOrder
    answer?: SortOrder
    modelUsed?: SortOrder
    responseTime?: SortOrder
    relevance?: SortOrder
    relevanceExplanation?: SortOrder
    promptTokens?: SortOrder
    completionTokens?: SortOrder
    totalTokens?: SortOrder
    cost?: SortOrder
    feedback?: SortOrder
    feedbackTimestamp?: SortOrder
    traceId?: SortOrder
    usedFallback?: SortOrder
    usedDeterministicFallback?: SortOrder
    responseLanguage?: SortOrder
    routeIntent?: SortOrder
    warningCount?: SortOrder
    createdAt?: SortOrder
  }

  export type ConversationMinOrderByAggregateInput = {
    id?: SortOrder
    userId?: SortOrder
    sessionId?: SortOrder
    question?: SortOrder
    answer?: SortOrder
    modelUsed?: SortOrder
    responseTime?: SortOrder
    relevance?: SortOrder
    relevanceExplanation?: SortOrder
    promptTokens?: SortOrder
    completionTokens?: SortOrder
    totalTokens?: SortOrder
    cost?: SortOrder
    feedback?: SortOrder
    feedbackTimestamp?: SortOrder
    traceId?: SortOrder
    usedFallback?: SortOrder
    usedDeterministicFallback?: SortOrder
    responseLanguage?: SortOrder
    routeIntent?: SortOrder
    warningCount?: SortOrder
    createdAt?: SortOrder
  }

  export type ConversationSumOrderByAggregateInput = {
    responseTime?: SortOrder
    promptTokens?: SortOrder
    completionTokens?: SortOrder
    totalTokens?: SortOrder
    cost?: SortOrder
    feedback?: SortOrder
    warningCount?: SortOrder
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

  export type ChatSessionCountOrderByAggregateInput = {
    id?: SortOrder
    userId?: SortOrder
    title?: SortOrder
    lastMessageAt?: SortOrder
    archivedAt?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type ChatSessionMaxOrderByAggregateInput = {
    id?: SortOrder
    userId?: SortOrder
    title?: SortOrder
    lastMessageAt?: SortOrder
    archivedAt?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type ChatSessionMinOrderByAggregateInput = {
    id?: SortOrder
    userId?: SortOrder
    title?: SortOrder
    lastMessageAt?: SortOrder
    archivedAt?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type UserMemoryCountOrderByAggregateInput = {
    id?: SortOrder
    userId?: SortOrder
    content?: SortOrder
    category?: SortOrder
    createdAt?: SortOrder
  }

  export type UserMemoryMaxOrderByAggregateInput = {
    id?: SortOrder
    userId?: SortOrder
    content?: SortOrder
    category?: SortOrder
    createdAt?: SortOrder
  }

  export type UserMemoryMinOrderByAggregateInput = {
    id?: SortOrder
    userId?: SortOrder
    content?: SortOrder
    category?: SortOrder
    createdAt?: SortOrder
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

  export type EnumPlanStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.PlanStatus | EnumPlanStatusFieldRefInput<$PrismaModel>
    in?: $Enums.PlanStatus[] | ListEnumPlanStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.PlanStatus[] | ListEnumPlanStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumPlanStatusFilter<$PrismaModel> | $Enums.PlanStatus
  }

  export type EnumPtReviewStatusNullableFilter<$PrismaModel = never> = {
    equals?: $Enums.PtReviewStatus | EnumPtReviewStatusFieldRefInput<$PrismaModel> | null
    in?: $Enums.PtReviewStatus[] | ListEnumPtReviewStatusFieldRefInput<$PrismaModel> | null
    notIn?: $Enums.PtReviewStatus[] | ListEnumPtReviewStatusFieldRefInput<$PrismaModel> | null
    not?: NestedEnumPtReviewStatusNullableFilter<$PrismaModel> | $Enums.PtReviewStatus | null
  }

  export type PublishedPlanListRelationFilter = {
    every?: PublishedPlanWhereInput
    some?: PublishedPlanWhereInput
    none?: PublishedPlanWhereInput
  }

  export type PublishedPlanOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type WorkoutPlanCountOrderByAggregateInput = {
    id?: SortOrder
    userId?: SortOrder
    name?: SortOrder
    description?: SortOrder
    goal?: SortOrder
    duration?: SortOrder
    daysPerWeek?: SortOrder
    plan?: SortOrder
    status?: SortOrder
    version?: SortOrder
    jobId?: SortOrder
    failReason?: SortOrder
    ptUserId?: SortOrder
    ptName?: SortOrder
    clientName?: SortOrder
    ptReviewStatus?: SortOrder
    ptNote?: SortOrder
    ptReviewedAt?: SortOrder
    archivedAt?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type WorkoutPlanAvgOrderByAggregateInput = {
    duration?: SortOrder
    daysPerWeek?: SortOrder
    version?: SortOrder
  }

  export type WorkoutPlanMaxOrderByAggregateInput = {
    id?: SortOrder
    userId?: SortOrder
    name?: SortOrder
    description?: SortOrder
    goal?: SortOrder
    duration?: SortOrder
    daysPerWeek?: SortOrder
    status?: SortOrder
    version?: SortOrder
    jobId?: SortOrder
    failReason?: SortOrder
    ptUserId?: SortOrder
    ptName?: SortOrder
    clientName?: SortOrder
    ptReviewStatus?: SortOrder
    ptNote?: SortOrder
    ptReviewedAt?: SortOrder
    archivedAt?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type WorkoutPlanMinOrderByAggregateInput = {
    id?: SortOrder
    userId?: SortOrder
    name?: SortOrder
    description?: SortOrder
    goal?: SortOrder
    duration?: SortOrder
    daysPerWeek?: SortOrder
    status?: SortOrder
    version?: SortOrder
    jobId?: SortOrder
    failReason?: SortOrder
    ptUserId?: SortOrder
    ptName?: SortOrder
    clientName?: SortOrder
    ptReviewStatus?: SortOrder
    ptNote?: SortOrder
    ptReviewedAt?: SortOrder
    archivedAt?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type WorkoutPlanSumOrderByAggregateInput = {
    duration?: SortOrder
    daysPerWeek?: SortOrder
    version?: SortOrder
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

  export type EnumPlanStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.PlanStatus | EnumPlanStatusFieldRefInput<$PrismaModel>
    in?: $Enums.PlanStatus[] | ListEnumPlanStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.PlanStatus[] | ListEnumPlanStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumPlanStatusWithAggregatesFilter<$PrismaModel> | $Enums.PlanStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumPlanStatusFilter<$PrismaModel>
    _max?: NestedEnumPlanStatusFilter<$PrismaModel>
  }

  export type EnumPtReviewStatusNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.PtReviewStatus | EnumPtReviewStatusFieldRefInput<$PrismaModel> | null
    in?: $Enums.PtReviewStatus[] | ListEnumPtReviewStatusFieldRefInput<$PrismaModel> | null
    notIn?: $Enums.PtReviewStatus[] | ListEnumPtReviewStatusFieldRefInput<$PrismaModel> | null
    not?: NestedEnumPtReviewStatusNullableWithAggregatesFilter<$PrismaModel> | $Enums.PtReviewStatus | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedEnumPtReviewStatusNullableFilter<$PrismaModel>
    _max?: NestedEnumPtReviewStatusNullableFilter<$PrismaModel>
  }

  export type EnumPublishModerationStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.PublishModerationStatus | EnumPublishModerationStatusFieldRefInput<$PrismaModel>
    in?: $Enums.PublishModerationStatus[] | ListEnumPublishModerationStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.PublishModerationStatus[] | ListEnumPublishModerationStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumPublishModerationStatusFilter<$PrismaModel> | $Enums.PublishModerationStatus
  }

  export type WorkoutPlanRelationFilter = {
    is?: WorkoutPlanWhereInput
    isNot?: WorkoutPlanWhereInput
  }

  export type PlanReviewListRelationFilter = {
    every?: PlanReviewWhereInput
    some?: PlanReviewWhereInput
    none?: PlanReviewWhereInput
  }

  export type TrainingPackageListRelationFilter = {
    every?: TrainingPackageWhereInput
    some?: TrainingPackageWhereInput
    none?: TrainingPackageWhereInput
  }

  export type PlanReviewOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type TrainingPackageOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type PublishedPlanCountOrderByAggregateInput = {
    id?: SortOrder
    sourcePlanId?: SortOrder
    publisherId?: SortOrder
    title?: SortOrder
    description?: SortOrder
    goal?: SortOrder
    moderationStatus?: SortOrder
    moderationNote?: SortOrder
    avgRating?: SortOrder
    ratingCount?: SortOrder
    publishedAt?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type PublishedPlanAvgOrderByAggregateInput = {
    avgRating?: SortOrder
    ratingCount?: SortOrder
  }

  export type PublishedPlanMaxOrderByAggregateInput = {
    id?: SortOrder
    sourcePlanId?: SortOrder
    publisherId?: SortOrder
    title?: SortOrder
    description?: SortOrder
    goal?: SortOrder
    moderationStatus?: SortOrder
    moderationNote?: SortOrder
    avgRating?: SortOrder
    ratingCount?: SortOrder
    publishedAt?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type PublishedPlanMinOrderByAggregateInput = {
    id?: SortOrder
    sourcePlanId?: SortOrder
    publisherId?: SortOrder
    title?: SortOrder
    description?: SortOrder
    goal?: SortOrder
    moderationStatus?: SortOrder
    moderationNote?: SortOrder
    avgRating?: SortOrder
    ratingCount?: SortOrder
    publishedAt?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type PublishedPlanSumOrderByAggregateInput = {
    avgRating?: SortOrder
    ratingCount?: SortOrder
  }

  export type EnumPublishModerationStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.PublishModerationStatus | EnumPublishModerationStatusFieldRefInput<$PrismaModel>
    in?: $Enums.PublishModerationStatus[] | ListEnumPublishModerationStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.PublishModerationStatus[] | ListEnumPublishModerationStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumPublishModerationStatusWithAggregatesFilter<$PrismaModel> | $Enums.PublishModerationStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumPublishModerationStatusFilter<$PrismaModel>
    _max?: NestedEnumPublishModerationStatusFilter<$PrismaModel>
  }

  export type PublishedPlanRelationFilter = {
    is?: PublishedPlanWhereInput
    isNot?: PublishedPlanWhereInput
  }

  export type PlanReviewPublishedPlanIdReviewerIdCompoundUniqueInput = {
    publishedPlanId: string
    reviewerId: string
  }

  export type PlanReviewCountOrderByAggregateInput = {
    id?: SortOrder
    publishedPlanId?: SortOrder
    reviewerId?: SortOrder
    rating?: SortOrder
    comment?: SortOrder
    createdAt?: SortOrder
  }

  export type PlanReviewAvgOrderByAggregateInput = {
    rating?: SortOrder
  }

  export type PlanReviewMaxOrderByAggregateInput = {
    id?: SortOrder
    publishedPlanId?: SortOrder
    reviewerId?: SortOrder
    rating?: SortOrder
    comment?: SortOrder
    createdAt?: SortOrder
  }

  export type PlanReviewMinOrderByAggregateInput = {
    id?: SortOrder
    publishedPlanId?: SortOrder
    reviewerId?: SortOrder
    rating?: SortOrder
    comment?: SortOrder
    createdAt?: SortOrder
  }

  export type PlanReviewSumOrderByAggregateInput = {
    rating?: SortOrder
  }

  export type EnumTrainingPackageStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.TrainingPackageStatus | EnumTrainingPackageStatusFieldRefInput<$PrismaModel>
    in?: $Enums.TrainingPackageStatus[] | ListEnumTrainingPackageStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.TrainingPackageStatus[] | ListEnumTrainingPackageStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumTrainingPackageStatusFilter<$PrismaModel> | $Enums.TrainingPackageStatus
  }

  export type TrainingPackagePurchaseListRelationFilter = {
    every?: TrainingPackagePurchaseWhereInput
    some?: TrainingPackagePurchaseWhereInput
    none?: TrainingPackagePurchaseWhereInput
  }

  export type TrainingPackagePurchaseOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type TrainingPackageCountOrderByAggregateInput = {
    id?: SortOrder
    sellerId?: SortOrder
    publishedPlanId?: SortOrder
    name?: SortOrder
    description?: SortOrder
    price?: SortOrder
    durationWeeks?: SortOrder
    status?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type TrainingPackageAvgOrderByAggregateInput = {
    price?: SortOrder
    durationWeeks?: SortOrder
  }

  export type TrainingPackageMaxOrderByAggregateInput = {
    id?: SortOrder
    sellerId?: SortOrder
    publishedPlanId?: SortOrder
    name?: SortOrder
    description?: SortOrder
    price?: SortOrder
    durationWeeks?: SortOrder
    status?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type TrainingPackageMinOrderByAggregateInput = {
    id?: SortOrder
    sellerId?: SortOrder
    publishedPlanId?: SortOrder
    name?: SortOrder
    description?: SortOrder
    price?: SortOrder
    durationWeeks?: SortOrder
    status?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type TrainingPackageSumOrderByAggregateInput = {
    price?: SortOrder
    durationWeeks?: SortOrder
  }

  export type EnumTrainingPackageStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.TrainingPackageStatus | EnumTrainingPackageStatusFieldRefInput<$PrismaModel>
    in?: $Enums.TrainingPackageStatus[] | ListEnumTrainingPackageStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.TrainingPackageStatus[] | ListEnumTrainingPackageStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumTrainingPackageStatusWithAggregatesFilter<$PrismaModel> | $Enums.TrainingPackageStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumTrainingPackageStatusFilter<$PrismaModel>
    _max?: NestedEnumTrainingPackageStatusFilter<$PrismaModel>
  }

  export type EnumTrainingPackagePurchaseStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.TrainingPackagePurchaseStatus | EnumTrainingPackagePurchaseStatusFieldRefInput<$PrismaModel>
    in?: $Enums.TrainingPackagePurchaseStatus[] | ListEnumTrainingPackagePurchaseStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.TrainingPackagePurchaseStatus[] | ListEnumTrainingPackagePurchaseStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumTrainingPackagePurchaseStatusFilter<$PrismaModel> | $Enums.TrainingPackagePurchaseStatus
  }

  export type TrainingPackageRelationFilter = {
    is?: TrainingPackageWhereInput
    isNot?: TrainingPackageWhereInput
  }

  export type TrainingPackagePurchasePackageIdBuyerIdCompoundUniqueInput = {
    packageId: string
    buyerId: string
  }

  export type TrainingPackagePurchaseCountOrderByAggregateInput = {
    id?: SortOrder
    packageId?: SortOrder
    buyerId?: SortOrder
    priceAtPurchase?: SortOrder
    paymentTransactionId?: SortOrder
    status?: SortOrder
    purchasedAt?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type TrainingPackagePurchaseAvgOrderByAggregateInput = {
    priceAtPurchase?: SortOrder
  }

  export type TrainingPackagePurchaseMaxOrderByAggregateInput = {
    id?: SortOrder
    packageId?: SortOrder
    buyerId?: SortOrder
    priceAtPurchase?: SortOrder
    paymentTransactionId?: SortOrder
    status?: SortOrder
    purchasedAt?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type TrainingPackagePurchaseMinOrderByAggregateInput = {
    id?: SortOrder
    packageId?: SortOrder
    buyerId?: SortOrder
    priceAtPurchase?: SortOrder
    paymentTransactionId?: SortOrder
    status?: SortOrder
    purchasedAt?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type TrainingPackagePurchaseSumOrderByAggregateInput = {
    priceAtPurchase?: SortOrder
  }

  export type EnumTrainingPackagePurchaseStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.TrainingPackagePurchaseStatus | EnumTrainingPackagePurchaseStatusFieldRefInput<$PrismaModel>
    in?: $Enums.TrainingPackagePurchaseStatus[] | ListEnumTrainingPackagePurchaseStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.TrainingPackagePurchaseStatus[] | ListEnumTrainingPackagePurchaseStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumTrainingPackagePurchaseStatusWithAggregatesFilter<$PrismaModel> | $Enums.TrainingPackagePurchaseStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumTrainingPackagePurchaseStatusFilter<$PrismaModel>
    _max?: NestedEnumTrainingPackagePurchaseStatusFilter<$PrismaModel>
  }

  export type NutritionPlanCountOrderByAggregateInput = {
    id?: SortOrder
    userId?: SortOrder
    name?: SortOrder
    goal?: SortOrder
    durationWeeks?: SortOrder
    mealsPerDay?: SortOrder
    plan?: SortOrder
    status?: SortOrder
    jobId?: SortOrder
    failReason?: SortOrder
    archivedAt?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type NutritionPlanAvgOrderByAggregateInput = {
    durationWeeks?: SortOrder
    mealsPerDay?: SortOrder
  }

  export type NutritionPlanMaxOrderByAggregateInput = {
    id?: SortOrder
    userId?: SortOrder
    name?: SortOrder
    goal?: SortOrder
    durationWeeks?: SortOrder
    mealsPerDay?: SortOrder
    status?: SortOrder
    jobId?: SortOrder
    failReason?: SortOrder
    archivedAt?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type NutritionPlanMinOrderByAggregateInput = {
    id?: SortOrder
    userId?: SortOrder
    name?: SortOrder
    goal?: SortOrder
    durationWeeks?: SortOrder
    mealsPerDay?: SortOrder
    status?: SortOrder
    jobId?: SortOrder
    failReason?: SortOrder
    archivedAt?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type NutritionPlanSumOrderByAggregateInput = {
    durationWeeks?: SortOrder
    mealsPerDay?: SortOrder
  }

  export type EnumKnowledgeSourceTypeFilter<$PrismaModel = never> = {
    equals?: $Enums.KnowledgeSourceType | EnumKnowledgeSourceTypeFieldRefInput<$PrismaModel>
    in?: $Enums.KnowledgeSourceType[] | ListEnumKnowledgeSourceTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.KnowledgeSourceType[] | ListEnumKnowledgeSourceTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumKnowledgeSourceTypeFilter<$PrismaModel> | $Enums.KnowledgeSourceType
  }

  export type KnowledgeDocumentListRelationFilter = {
    every?: KnowledgeDocumentWhereInput
    some?: KnowledgeDocumentWhereInput
    none?: KnowledgeDocumentWhereInput
  }

  export type KnowledgeDocumentOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type KnowledgeSourceCountOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    baseUrl?: SortOrder
    sourceType?: SortOrder
    trustTier?: SortOrder
    crawlCron?: SortOrder
    isActive?: SortOrder
    lastCrawledAt?: SortOrder
    createdAt?: SortOrder
  }

  export type KnowledgeSourceAvgOrderByAggregateInput = {
    trustTier?: SortOrder
  }

  export type KnowledgeSourceMaxOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    baseUrl?: SortOrder
    sourceType?: SortOrder
    trustTier?: SortOrder
    crawlCron?: SortOrder
    isActive?: SortOrder
    lastCrawledAt?: SortOrder
    createdAt?: SortOrder
  }

  export type KnowledgeSourceMinOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    baseUrl?: SortOrder
    sourceType?: SortOrder
    trustTier?: SortOrder
    crawlCron?: SortOrder
    isActive?: SortOrder
    lastCrawledAt?: SortOrder
    createdAt?: SortOrder
  }

  export type KnowledgeSourceSumOrderByAggregateInput = {
    trustTier?: SortOrder
  }

  export type EnumKnowledgeSourceTypeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.KnowledgeSourceType | EnumKnowledgeSourceTypeFieldRefInput<$PrismaModel>
    in?: $Enums.KnowledgeSourceType[] | ListEnumKnowledgeSourceTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.KnowledgeSourceType[] | ListEnumKnowledgeSourceTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumKnowledgeSourceTypeWithAggregatesFilter<$PrismaModel> | $Enums.KnowledgeSourceType
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumKnowledgeSourceTypeFilter<$PrismaModel>
    _max?: NestedEnumKnowledgeSourceTypeFilter<$PrismaModel>
  }

  export type EnumKnowledgeDocumentTopicNullableFilter<$PrismaModel = never> = {
    equals?: $Enums.KnowledgeDocumentTopic | EnumKnowledgeDocumentTopicFieldRefInput<$PrismaModel> | null
    in?: $Enums.KnowledgeDocumentTopic[] | ListEnumKnowledgeDocumentTopicFieldRefInput<$PrismaModel> | null
    notIn?: $Enums.KnowledgeDocumentTopic[] | ListEnumKnowledgeDocumentTopicFieldRefInput<$PrismaModel> | null
    not?: NestedEnumKnowledgeDocumentTopicNullableFilter<$PrismaModel> | $Enums.KnowledgeDocumentTopic | null
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

  export type EnumKnowledgeDocumentStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.KnowledgeDocumentStatus | EnumKnowledgeDocumentStatusFieldRefInput<$PrismaModel>
    in?: $Enums.KnowledgeDocumentStatus[] | ListEnumKnowledgeDocumentStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.KnowledgeDocumentStatus[] | ListEnumKnowledgeDocumentStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumKnowledgeDocumentStatusFilter<$PrismaModel> | $Enums.KnowledgeDocumentStatus
  }

  export type KnowledgeSourceRelationFilter = {
    is?: KnowledgeSourceWhereInput
    isNot?: KnowledgeSourceWhereInput
  }

  export type KnowledgeChunkListRelationFilter = {
    every?: KnowledgeChunkWhereInput
    some?: KnowledgeChunkWhereInput
    none?: KnowledgeChunkWhereInput
  }

  export type KnowledgeReviewItemListRelationFilter = {
    every?: KnowledgeReviewItemWhereInput
    some?: KnowledgeReviewItemWhereInput
    none?: KnowledgeReviewItemWhereInput
  }

  export type KnowledgeChunkOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type KnowledgeReviewItemOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type KnowledgeDocumentCountOrderByAggregateInput = {
    id?: SortOrder
    sourceId?: SortOrder
    url?: SortOrder
    title?: SortOrder
    author?: SortOrder
    language?: SortOrder
    contentHash?: SortOrder
    rawObjectKey?: SortOrder
    cleanText?: SortOrder
    topic?: SortOrder
    trustScore?: SortOrder
    qualityScore?: SortOrder
    safetyFlag?: SortOrder
    status?: SortOrder
    rejectionReason?: SortOrder
    publishedAt?: SortOrder
    crawledAt?: SortOrder
    processedAt?: SortOrder
  }

  export type KnowledgeDocumentAvgOrderByAggregateInput = {
    trustScore?: SortOrder
    qualityScore?: SortOrder
  }

  export type KnowledgeDocumentMaxOrderByAggregateInput = {
    id?: SortOrder
    sourceId?: SortOrder
    url?: SortOrder
    title?: SortOrder
    author?: SortOrder
    language?: SortOrder
    contentHash?: SortOrder
    rawObjectKey?: SortOrder
    cleanText?: SortOrder
    topic?: SortOrder
    trustScore?: SortOrder
    qualityScore?: SortOrder
    safetyFlag?: SortOrder
    status?: SortOrder
    rejectionReason?: SortOrder
    publishedAt?: SortOrder
    crawledAt?: SortOrder
    processedAt?: SortOrder
  }

  export type KnowledgeDocumentMinOrderByAggregateInput = {
    id?: SortOrder
    sourceId?: SortOrder
    url?: SortOrder
    title?: SortOrder
    author?: SortOrder
    language?: SortOrder
    contentHash?: SortOrder
    rawObjectKey?: SortOrder
    cleanText?: SortOrder
    topic?: SortOrder
    trustScore?: SortOrder
    qualityScore?: SortOrder
    safetyFlag?: SortOrder
    status?: SortOrder
    rejectionReason?: SortOrder
    publishedAt?: SortOrder
    crawledAt?: SortOrder
    processedAt?: SortOrder
  }

  export type KnowledgeDocumentSumOrderByAggregateInput = {
    trustScore?: SortOrder
    qualityScore?: SortOrder
  }

  export type EnumKnowledgeDocumentTopicNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.KnowledgeDocumentTopic | EnumKnowledgeDocumentTopicFieldRefInput<$PrismaModel> | null
    in?: $Enums.KnowledgeDocumentTopic[] | ListEnumKnowledgeDocumentTopicFieldRefInput<$PrismaModel> | null
    notIn?: $Enums.KnowledgeDocumentTopic[] | ListEnumKnowledgeDocumentTopicFieldRefInput<$PrismaModel> | null
    not?: NestedEnumKnowledgeDocumentTopicNullableWithAggregatesFilter<$PrismaModel> | $Enums.KnowledgeDocumentTopic | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedEnumKnowledgeDocumentTopicNullableFilter<$PrismaModel>
    _max?: NestedEnumKnowledgeDocumentTopicNullableFilter<$PrismaModel>
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

  export type EnumKnowledgeDocumentStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.KnowledgeDocumentStatus | EnumKnowledgeDocumentStatusFieldRefInput<$PrismaModel>
    in?: $Enums.KnowledgeDocumentStatus[] | ListEnumKnowledgeDocumentStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.KnowledgeDocumentStatus[] | ListEnumKnowledgeDocumentStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumKnowledgeDocumentStatusWithAggregatesFilter<$PrismaModel> | $Enums.KnowledgeDocumentStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumKnowledgeDocumentStatusFilter<$PrismaModel>
    _max?: NestedEnumKnowledgeDocumentStatusFilter<$PrismaModel>
  }

  export type KnowledgeDocumentRelationFilter = {
    is?: KnowledgeDocumentWhereInput
    isNot?: KnowledgeDocumentWhereInput
  }

  export type KnowledgeChunkDocumentIdChunkIndexCompoundUniqueInput = {
    documentId: string
    chunkIndex: number
  }

  export type KnowledgeChunkCountOrderByAggregateInput = {
    id?: SortOrder
    documentId?: SortOrder
    chunkIndex?: SortOrder
    text?: SortOrder
    tokenCount?: SortOrder
    vectorId?: SortOrder
    embeddedAt?: SortOrder
  }

  export type KnowledgeChunkAvgOrderByAggregateInput = {
    chunkIndex?: SortOrder
    tokenCount?: SortOrder
  }

  export type KnowledgeChunkMaxOrderByAggregateInput = {
    id?: SortOrder
    documentId?: SortOrder
    chunkIndex?: SortOrder
    text?: SortOrder
    tokenCount?: SortOrder
    vectorId?: SortOrder
    embeddedAt?: SortOrder
  }

  export type KnowledgeChunkMinOrderByAggregateInput = {
    id?: SortOrder
    documentId?: SortOrder
    chunkIndex?: SortOrder
    text?: SortOrder
    tokenCount?: SortOrder
    vectorId?: SortOrder
    embeddedAt?: SortOrder
  }

  export type KnowledgeChunkSumOrderByAggregateInput = {
    chunkIndex?: SortOrder
    tokenCount?: SortOrder
  }

  export type EnumKnowledgePipelineRunStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.KnowledgePipelineRunStatus | EnumKnowledgePipelineRunStatusFieldRefInput<$PrismaModel>
    in?: $Enums.KnowledgePipelineRunStatus[] | ListEnumKnowledgePipelineRunStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.KnowledgePipelineRunStatus[] | ListEnumKnowledgePipelineRunStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumKnowledgePipelineRunStatusFilter<$PrismaModel> | $Enums.KnowledgePipelineRunStatus
  }

  export type KnowledgePipelineRunCountOrderByAggregateInput = {
    id?: SortOrder
    runType?: SortOrder
    startedAt?: SortOrder
    finishedAt?: SortOrder
    docsCrawled?: SortOrder
    docsAccepted?: SortOrder
    docsRejected?: SortOrder
    docsReview?: SortOrder
    status?: SortOrder
  }

  export type KnowledgePipelineRunAvgOrderByAggregateInput = {
    docsCrawled?: SortOrder
    docsAccepted?: SortOrder
    docsRejected?: SortOrder
    docsReview?: SortOrder
  }

  export type KnowledgePipelineRunMaxOrderByAggregateInput = {
    id?: SortOrder
    runType?: SortOrder
    startedAt?: SortOrder
    finishedAt?: SortOrder
    docsCrawled?: SortOrder
    docsAccepted?: SortOrder
    docsRejected?: SortOrder
    docsReview?: SortOrder
    status?: SortOrder
  }

  export type KnowledgePipelineRunMinOrderByAggregateInput = {
    id?: SortOrder
    runType?: SortOrder
    startedAt?: SortOrder
    finishedAt?: SortOrder
    docsCrawled?: SortOrder
    docsAccepted?: SortOrder
    docsRejected?: SortOrder
    docsReview?: SortOrder
    status?: SortOrder
  }

  export type KnowledgePipelineRunSumOrderByAggregateInput = {
    docsCrawled?: SortOrder
    docsAccepted?: SortOrder
    docsRejected?: SortOrder
    docsReview?: SortOrder
  }

  export type EnumKnowledgePipelineRunStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.KnowledgePipelineRunStatus | EnumKnowledgePipelineRunStatusFieldRefInput<$PrismaModel>
    in?: $Enums.KnowledgePipelineRunStatus[] | ListEnumKnowledgePipelineRunStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.KnowledgePipelineRunStatus[] | ListEnumKnowledgePipelineRunStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumKnowledgePipelineRunStatusWithAggregatesFilter<$PrismaModel> | $Enums.KnowledgePipelineRunStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumKnowledgePipelineRunStatusFilter<$PrismaModel>
    _max?: NestedEnumKnowledgePipelineRunStatusFilter<$PrismaModel>
  }

  export type EnumKnowledgeReviewStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.KnowledgeReviewStatus | EnumKnowledgeReviewStatusFieldRefInput<$PrismaModel>
    in?: $Enums.KnowledgeReviewStatus[] | ListEnumKnowledgeReviewStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.KnowledgeReviewStatus[] | ListEnumKnowledgeReviewStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumKnowledgeReviewStatusFilter<$PrismaModel> | $Enums.KnowledgeReviewStatus
  }

  export type KnowledgeReviewItemCountOrderByAggregateInput = {
    id?: SortOrder
    documentId?: SortOrder
    reason?: SortOrder
    status?: SortOrder
    reviewedBy?: SortOrder
    reviewedAt?: SortOrder
  }

  export type KnowledgeReviewItemMaxOrderByAggregateInput = {
    id?: SortOrder
    documentId?: SortOrder
    reason?: SortOrder
    status?: SortOrder
    reviewedBy?: SortOrder
    reviewedAt?: SortOrder
  }

  export type KnowledgeReviewItemMinOrderByAggregateInput = {
    id?: SortOrder
    documentId?: SortOrder
    reason?: SortOrder
    status?: SortOrder
    reviewedBy?: SortOrder
    reviewedAt?: SortOrder
  }

  export type EnumKnowledgeReviewStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.KnowledgeReviewStatus | EnumKnowledgeReviewStatusFieldRefInput<$PrismaModel>
    in?: $Enums.KnowledgeReviewStatus[] | ListEnumKnowledgeReviewStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.KnowledgeReviewStatus[] | ListEnumKnowledgeReviewStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumKnowledgeReviewStatusWithAggregatesFilter<$PrismaModel> | $Enums.KnowledgeReviewStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumKnowledgeReviewStatusFilter<$PrismaModel>
    _max?: NestedEnumKnowledgeReviewStatusFilter<$PrismaModel>
  }

  export type StringFieldUpdateOperationsInput = {
    set?: string
  }

  export type NullableStringFieldUpdateOperationsInput = {
    set?: string | null
  }

  export type FloatFieldUpdateOperationsInput = {
    set?: number
    increment?: number
    decrement?: number
    multiply?: number
    divide?: number
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

  export type NullableDateTimeFieldUpdateOperationsInput = {
    set?: Date | string | null
  }

  export type BoolFieldUpdateOperationsInput = {
    set?: boolean
  }

  export type DateTimeFieldUpdateOperationsInput = {
    set?: Date | string
  }

  export type PublishedPlanCreateNestedManyWithoutSourcePlanInput = {
    create?: XOR<PublishedPlanCreateWithoutSourcePlanInput, PublishedPlanUncheckedCreateWithoutSourcePlanInput> | PublishedPlanCreateWithoutSourcePlanInput[] | PublishedPlanUncheckedCreateWithoutSourcePlanInput[]
    connectOrCreate?: PublishedPlanCreateOrConnectWithoutSourcePlanInput | PublishedPlanCreateOrConnectWithoutSourcePlanInput[]
    createMany?: PublishedPlanCreateManySourcePlanInputEnvelope
    connect?: PublishedPlanWhereUniqueInput | PublishedPlanWhereUniqueInput[]
  }

  export type PublishedPlanUncheckedCreateNestedManyWithoutSourcePlanInput = {
    create?: XOR<PublishedPlanCreateWithoutSourcePlanInput, PublishedPlanUncheckedCreateWithoutSourcePlanInput> | PublishedPlanCreateWithoutSourcePlanInput[] | PublishedPlanUncheckedCreateWithoutSourcePlanInput[]
    connectOrCreate?: PublishedPlanCreateOrConnectWithoutSourcePlanInput | PublishedPlanCreateOrConnectWithoutSourcePlanInput[]
    createMany?: PublishedPlanCreateManySourcePlanInputEnvelope
    connect?: PublishedPlanWhereUniqueInput | PublishedPlanWhereUniqueInput[]
  }

  export type EnumPlanStatusFieldUpdateOperationsInput = {
    set?: $Enums.PlanStatus
  }

  export type NullableEnumPtReviewStatusFieldUpdateOperationsInput = {
    set?: $Enums.PtReviewStatus | null
  }

  export type PublishedPlanUpdateManyWithoutSourcePlanNestedInput = {
    create?: XOR<PublishedPlanCreateWithoutSourcePlanInput, PublishedPlanUncheckedCreateWithoutSourcePlanInput> | PublishedPlanCreateWithoutSourcePlanInput[] | PublishedPlanUncheckedCreateWithoutSourcePlanInput[]
    connectOrCreate?: PublishedPlanCreateOrConnectWithoutSourcePlanInput | PublishedPlanCreateOrConnectWithoutSourcePlanInput[]
    upsert?: PublishedPlanUpsertWithWhereUniqueWithoutSourcePlanInput | PublishedPlanUpsertWithWhereUniqueWithoutSourcePlanInput[]
    createMany?: PublishedPlanCreateManySourcePlanInputEnvelope
    set?: PublishedPlanWhereUniqueInput | PublishedPlanWhereUniqueInput[]
    disconnect?: PublishedPlanWhereUniqueInput | PublishedPlanWhereUniqueInput[]
    delete?: PublishedPlanWhereUniqueInput | PublishedPlanWhereUniqueInput[]
    connect?: PublishedPlanWhereUniqueInput | PublishedPlanWhereUniqueInput[]
    update?: PublishedPlanUpdateWithWhereUniqueWithoutSourcePlanInput | PublishedPlanUpdateWithWhereUniqueWithoutSourcePlanInput[]
    updateMany?: PublishedPlanUpdateManyWithWhereWithoutSourcePlanInput | PublishedPlanUpdateManyWithWhereWithoutSourcePlanInput[]
    deleteMany?: PublishedPlanScalarWhereInput | PublishedPlanScalarWhereInput[]
  }

  export type PublishedPlanUncheckedUpdateManyWithoutSourcePlanNestedInput = {
    create?: XOR<PublishedPlanCreateWithoutSourcePlanInput, PublishedPlanUncheckedCreateWithoutSourcePlanInput> | PublishedPlanCreateWithoutSourcePlanInput[] | PublishedPlanUncheckedCreateWithoutSourcePlanInput[]
    connectOrCreate?: PublishedPlanCreateOrConnectWithoutSourcePlanInput | PublishedPlanCreateOrConnectWithoutSourcePlanInput[]
    upsert?: PublishedPlanUpsertWithWhereUniqueWithoutSourcePlanInput | PublishedPlanUpsertWithWhereUniqueWithoutSourcePlanInput[]
    createMany?: PublishedPlanCreateManySourcePlanInputEnvelope
    set?: PublishedPlanWhereUniqueInput | PublishedPlanWhereUniqueInput[]
    disconnect?: PublishedPlanWhereUniqueInput | PublishedPlanWhereUniqueInput[]
    delete?: PublishedPlanWhereUniqueInput | PublishedPlanWhereUniqueInput[]
    connect?: PublishedPlanWhereUniqueInput | PublishedPlanWhereUniqueInput[]
    update?: PublishedPlanUpdateWithWhereUniqueWithoutSourcePlanInput | PublishedPlanUpdateWithWhereUniqueWithoutSourcePlanInput[]
    updateMany?: PublishedPlanUpdateManyWithWhereWithoutSourcePlanInput | PublishedPlanUpdateManyWithWhereWithoutSourcePlanInput[]
    deleteMany?: PublishedPlanScalarWhereInput | PublishedPlanScalarWhereInput[]
  }

  export type WorkoutPlanCreateNestedOneWithoutPublishedListingsInput = {
    create?: XOR<WorkoutPlanCreateWithoutPublishedListingsInput, WorkoutPlanUncheckedCreateWithoutPublishedListingsInput>
    connectOrCreate?: WorkoutPlanCreateOrConnectWithoutPublishedListingsInput
    connect?: WorkoutPlanWhereUniqueInput
  }

  export type PlanReviewCreateNestedManyWithoutPublishedPlanInput = {
    create?: XOR<PlanReviewCreateWithoutPublishedPlanInput, PlanReviewUncheckedCreateWithoutPublishedPlanInput> | PlanReviewCreateWithoutPublishedPlanInput[] | PlanReviewUncheckedCreateWithoutPublishedPlanInput[]
    connectOrCreate?: PlanReviewCreateOrConnectWithoutPublishedPlanInput | PlanReviewCreateOrConnectWithoutPublishedPlanInput[]
    createMany?: PlanReviewCreateManyPublishedPlanInputEnvelope
    connect?: PlanReviewWhereUniqueInput | PlanReviewWhereUniqueInput[]
  }

  export type TrainingPackageCreateNestedManyWithoutPublishedPlanInput = {
    create?: XOR<TrainingPackageCreateWithoutPublishedPlanInput, TrainingPackageUncheckedCreateWithoutPublishedPlanInput> | TrainingPackageCreateWithoutPublishedPlanInput[] | TrainingPackageUncheckedCreateWithoutPublishedPlanInput[]
    connectOrCreate?: TrainingPackageCreateOrConnectWithoutPublishedPlanInput | TrainingPackageCreateOrConnectWithoutPublishedPlanInput[]
    createMany?: TrainingPackageCreateManyPublishedPlanInputEnvelope
    connect?: TrainingPackageWhereUniqueInput | TrainingPackageWhereUniqueInput[]
  }

  export type PlanReviewUncheckedCreateNestedManyWithoutPublishedPlanInput = {
    create?: XOR<PlanReviewCreateWithoutPublishedPlanInput, PlanReviewUncheckedCreateWithoutPublishedPlanInput> | PlanReviewCreateWithoutPublishedPlanInput[] | PlanReviewUncheckedCreateWithoutPublishedPlanInput[]
    connectOrCreate?: PlanReviewCreateOrConnectWithoutPublishedPlanInput | PlanReviewCreateOrConnectWithoutPublishedPlanInput[]
    createMany?: PlanReviewCreateManyPublishedPlanInputEnvelope
    connect?: PlanReviewWhereUniqueInput | PlanReviewWhereUniqueInput[]
  }

  export type TrainingPackageUncheckedCreateNestedManyWithoutPublishedPlanInput = {
    create?: XOR<TrainingPackageCreateWithoutPublishedPlanInput, TrainingPackageUncheckedCreateWithoutPublishedPlanInput> | TrainingPackageCreateWithoutPublishedPlanInput[] | TrainingPackageUncheckedCreateWithoutPublishedPlanInput[]
    connectOrCreate?: TrainingPackageCreateOrConnectWithoutPublishedPlanInput | TrainingPackageCreateOrConnectWithoutPublishedPlanInput[]
    createMany?: TrainingPackageCreateManyPublishedPlanInputEnvelope
    connect?: TrainingPackageWhereUniqueInput | TrainingPackageWhereUniqueInput[]
  }

  export type EnumPublishModerationStatusFieldUpdateOperationsInput = {
    set?: $Enums.PublishModerationStatus
  }

  export type WorkoutPlanUpdateOneRequiredWithoutPublishedListingsNestedInput = {
    create?: XOR<WorkoutPlanCreateWithoutPublishedListingsInput, WorkoutPlanUncheckedCreateWithoutPublishedListingsInput>
    connectOrCreate?: WorkoutPlanCreateOrConnectWithoutPublishedListingsInput
    upsert?: WorkoutPlanUpsertWithoutPublishedListingsInput
    connect?: WorkoutPlanWhereUniqueInput
    update?: XOR<XOR<WorkoutPlanUpdateToOneWithWhereWithoutPublishedListingsInput, WorkoutPlanUpdateWithoutPublishedListingsInput>, WorkoutPlanUncheckedUpdateWithoutPublishedListingsInput>
  }

  export type PlanReviewUpdateManyWithoutPublishedPlanNestedInput = {
    create?: XOR<PlanReviewCreateWithoutPublishedPlanInput, PlanReviewUncheckedCreateWithoutPublishedPlanInput> | PlanReviewCreateWithoutPublishedPlanInput[] | PlanReviewUncheckedCreateWithoutPublishedPlanInput[]
    connectOrCreate?: PlanReviewCreateOrConnectWithoutPublishedPlanInput | PlanReviewCreateOrConnectWithoutPublishedPlanInput[]
    upsert?: PlanReviewUpsertWithWhereUniqueWithoutPublishedPlanInput | PlanReviewUpsertWithWhereUniqueWithoutPublishedPlanInput[]
    createMany?: PlanReviewCreateManyPublishedPlanInputEnvelope
    set?: PlanReviewWhereUniqueInput | PlanReviewWhereUniqueInput[]
    disconnect?: PlanReviewWhereUniqueInput | PlanReviewWhereUniqueInput[]
    delete?: PlanReviewWhereUniqueInput | PlanReviewWhereUniqueInput[]
    connect?: PlanReviewWhereUniqueInput | PlanReviewWhereUniqueInput[]
    update?: PlanReviewUpdateWithWhereUniqueWithoutPublishedPlanInput | PlanReviewUpdateWithWhereUniqueWithoutPublishedPlanInput[]
    updateMany?: PlanReviewUpdateManyWithWhereWithoutPublishedPlanInput | PlanReviewUpdateManyWithWhereWithoutPublishedPlanInput[]
    deleteMany?: PlanReviewScalarWhereInput | PlanReviewScalarWhereInput[]
  }

  export type TrainingPackageUpdateManyWithoutPublishedPlanNestedInput = {
    create?: XOR<TrainingPackageCreateWithoutPublishedPlanInput, TrainingPackageUncheckedCreateWithoutPublishedPlanInput> | TrainingPackageCreateWithoutPublishedPlanInput[] | TrainingPackageUncheckedCreateWithoutPublishedPlanInput[]
    connectOrCreate?: TrainingPackageCreateOrConnectWithoutPublishedPlanInput | TrainingPackageCreateOrConnectWithoutPublishedPlanInput[]
    upsert?: TrainingPackageUpsertWithWhereUniqueWithoutPublishedPlanInput | TrainingPackageUpsertWithWhereUniqueWithoutPublishedPlanInput[]
    createMany?: TrainingPackageCreateManyPublishedPlanInputEnvelope
    set?: TrainingPackageWhereUniqueInput | TrainingPackageWhereUniqueInput[]
    disconnect?: TrainingPackageWhereUniqueInput | TrainingPackageWhereUniqueInput[]
    delete?: TrainingPackageWhereUniqueInput | TrainingPackageWhereUniqueInput[]
    connect?: TrainingPackageWhereUniqueInput | TrainingPackageWhereUniqueInput[]
    update?: TrainingPackageUpdateWithWhereUniqueWithoutPublishedPlanInput | TrainingPackageUpdateWithWhereUniqueWithoutPublishedPlanInput[]
    updateMany?: TrainingPackageUpdateManyWithWhereWithoutPublishedPlanInput | TrainingPackageUpdateManyWithWhereWithoutPublishedPlanInput[]
    deleteMany?: TrainingPackageScalarWhereInput | TrainingPackageScalarWhereInput[]
  }

  export type PlanReviewUncheckedUpdateManyWithoutPublishedPlanNestedInput = {
    create?: XOR<PlanReviewCreateWithoutPublishedPlanInput, PlanReviewUncheckedCreateWithoutPublishedPlanInput> | PlanReviewCreateWithoutPublishedPlanInput[] | PlanReviewUncheckedCreateWithoutPublishedPlanInput[]
    connectOrCreate?: PlanReviewCreateOrConnectWithoutPublishedPlanInput | PlanReviewCreateOrConnectWithoutPublishedPlanInput[]
    upsert?: PlanReviewUpsertWithWhereUniqueWithoutPublishedPlanInput | PlanReviewUpsertWithWhereUniqueWithoutPublishedPlanInput[]
    createMany?: PlanReviewCreateManyPublishedPlanInputEnvelope
    set?: PlanReviewWhereUniqueInput | PlanReviewWhereUniqueInput[]
    disconnect?: PlanReviewWhereUniqueInput | PlanReviewWhereUniqueInput[]
    delete?: PlanReviewWhereUniqueInput | PlanReviewWhereUniqueInput[]
    connect?: PlanReviewWhereUniqueInput | PlanReviewWhereUniqueInput[]
    update?: PlanReviewUpdateWithWhereUniqueWithoutPublishedPlanInput | PlanReviewUpdateWithWhereUniqueWithoutPublishedPlanInput[]
    updateMany?: PlanReviewUpdateManyWithWhereWithoutPublishedPlanInput | PlanReviewUpdateManyWithWhereWithoutPublishedPlanInput[]
    deleteMany?: PlanReviewScalarWhereInput | PlanReviewScalarWhereInput[]
  }

  export type TrainingPackageUncheckedUpdateManyWithoutPublishedPlanNestedInput = {
    create?: XOR<TrainingPackageCreateWithoutPublishedPlanInput, TrainingPackageUncheckedCreateWithoutPublishedPlanInput> | TrainingPackageCreateWithoutPublishedPlanInput[] | TrainingPackageUncheckedCreateWithoutPublishedPlanInput[]
    connectOrCreate?: TrainingPackageCreateOrConnectWithoutPublishedPlanInput | TrainingPackageCreateOrConnectWithoutPublishedPlanInput[]
    upsert?: TrainingPackageUpsertWithWhereUniqueWithoutPublishedPlanInput | TrainingPackageUpsertWithWhereUniqueWithoutPublishedPlanInput[]
    createMany?: TrainingPackageCreateManyPublishedPlanInputEnvelope
    set?: TrainingPackageWhereUniqueInput | TrainingPackageWhereUniqueInput[]
    disconnect?: TrainingPackageWhereUniqueInput | TrainingPackageWhereUniqueInput[]
    delete?: TrainingPackageWhereUniqueInput | TrainingPackageWhereUniqueInput[]
    connect?: TrainingPackageWhereUniqueInput | TrainingPackageWhereUniqueInput[]
    update?: TrainingPackageUpdateWithWhereUniqueWithoutPublishedPlanInput | TrainingPackageUpdateWithWhereUniqueWithoutPublishedPlanInput[]
    updateMany?: TrainingPackageUpdateManyWithWhereWithoutPublishedPlanInput | TrainingPackageUpdateManyWithWhereWithoutPublishedPlanInput[]
    deleteMany?: TrainingPackageScalarWhereInput | TrainingPackageScalarWhereInput[]
  }

  export type PublishedPlanCreateNestedOneWithoutReviewsInput = {
    create?: XOR<PublishedPlanCreateWithoutReviewsInput, PublishedPlanUncheckedCreateWithoutReviewsInput>
    connectOrCreate?: PublishedPlanCreateOrConnectWithoutReviewsInput
    connect?: PublishedPlanWhereUniqueInput
  }

  export type PublishedPlanUpdateOneRequiredWithoutReviewsNestedInput = {
    create?: XOR<PublishedPlanCreateWithoutReviewsInput, PublishedPlanUncheckedCreateWithoutReviewsInput>
    connectOrCreate?: PublishedPlanCreateOrConnectWithoutReviewsInput
    upsert?: PublishedPlanUpsertWithoutReviewsInput
    connect?: PublishedPlanWhereUniqueInput
    update?: XOR<XOR<PublishedPlanUpdateToOneWithWhereWithoutReviewsInput, PublishedPlanUpdateWithoutReviewsInput>, PublishedPlanUncheckedUpdateWithoutReviewsInput>
  }

  export type PublishedPlanCreateNestedOneWithoutPackagesInput = {
    create?: XOR<PublishedPlanCreateWithoutPackagesInput, PublishedPlanUncheckedCreateWithoutPackagesInput>
    connectOrCreate?: PublishedPlanCreateOrConnectWithoutPackagesInput
    connect?: PublishedPlanWhereUniqueInput
  }

  export type TrainingPackagePurchaseCreateNestedManyWithoutPackageInput = {
    create?: XOR<TrainingPackagePurchaseCreateWithoutPackageInput, TrainingPackagePurchaseUncheckedCreateWithoutPackageInput> | TrainingPackagePurchaseCreateWithoutPackageInput[] | TrainingPackagePurchaseUncheckedCreateWithoutPackageInput[]
    connectOrCreate?: TrainingPackagePurchaseCreateOrConnectWithoutPackageInput | TrainingPackagePurchaseCreateOrConnectWithoutPackageInput[]
    createMany?: TrainingPackagePurchaseCreateManyPackageInputEnvelope
    connect?: TrainingPackagePurchaseWhereUniqueInput | TrainingPackagePurchaseWhereUniqueInput[]
  }

  export type TrainingPackagePurchaseUncheckedCreateNestedManyWithoutPackageInput = {
    create?: XOR<TrainingPackagePurchaseCreateWithoutPackageInput, TrainingPackagePurchaseUncheckedCreateWithoutPackageInput> | TrainingPackagePurchaseCreateWithoutPackageInput[] | TrainingPackagePurchaseUncheckedCreateWithoutPackageInput[]
    connectOrCreate?: TrainingPackagePurchaseCreateOrConnectWithoutPackageInput | TrainingPackagePurchaseCreateOrConnectWithoutPackageInput[]
    createMany?: TrainingPackagePurchaseCreateManyPackageInputEnvelope
    connect?: TrainingPackagePurchaseWhereUniqueInput | TrainingPackagePurchaseWhereUniqueInput[]
  }

  export type EnumTrainingPackageStatusFieldUpdateOperationsInput = {
    set?: $Enums.TrainingPackageStatus
  }

  export type PublishedPlanUpdateOneRequiredWithoutPackagesNestedInput = {
    create?: XOR<PublishedPlanCreateWithoutPackagesInput, PublishedPlanUncheckedCreateWithoutPackagesInput>
    connectOrCreate?: PublishedPlanCreateOrConnectWithoutPackagesInput
    upsert?: PublishedPlanUpsertWithoutPackagesInput
    connect?: PublishedPlanWhereUniqueInput
    update?: XOR<XOR<PublishedPlanUpdateToOneWithWhereWithoutPackagesInput, PublishedPlanUpdateWithoutPackagesInput>, PublishedPlanUncheckedUpdateWithoutPackagesInput>
  }

  export type TrainingPackagePurchaseUpdateManyWithoutPackageNestedInput = {
    create?: XOR<TrainingPackagePurchaseCreateWithoutPackageInput, TrainingPackagePurchaseUncheckedCreateWithoutPackageInput> | TrainingPackagePurchaseCreateWithoutPackageInput[] | TrainingPackagePurchaseUncheckedCreateWithoutPackageInput[]
    connectOrCreate?: TrainingPackagePurchaseCreateOrConnectWithoutPackageInput | TrainingPackagePurchaseCreateOrConnectWithoutPackageInput[]
    upsert?: TrainingPackagePurchaseUpsertWithWhereUniqueWithoutPackageInput | TrainingPackagePurchaseUpsertWithWhereUniqueWithoutPackageInput[]
    createMany?: TrainingPackagePurchaseCreateManyPackageInputEnvelope
    set?: TrainingPackagePurchaseWhereUniqueInput | TrainingPackagePurchaseWhereUniqueInput[]
    disconnect?: TrainingPackagePurchaseWhereUniqueInput | TrainingPackagePurchaseWhereUniqueInput[]
    delete?: TrainingPackagePurchaseWhereUniqueInput | TrainingPackagePurchaseWhereUniqueInput[]
    connect?: TrainingPackagePurchaseWhereUniqueInput | TrainingPackagePurchaseWhereUniqueInput[]
    update?: TrainingPackagePurchaseUpdateWithWhereUniqueWithoutPackageInput | TrainingPackagePurchaseUpdateWithWhereUniqueWithoutPackageInput[]
    updateMany?: TrainingPackagePurchaseUpdateManyWithWhereWithoutPackageInput | TrainingPackagePurchaseUpdateManyWithWhereWithoutPackageInput[]
    deleteMany?: TrainingPackagePurchaseScalarWhereInput | TrainingPackagePurchaseScalarWhereInput[]
  }

  export type TrainingPackagePurchaseUncheckedUpdateManyWithoutPackageNestedInput = {
    create?: XOR<TrainingPackagePurchaseCreateWithoutPackageInput, TrainingPackagePurchaseUncheckedCreateWithoutPackageInput> | TrainingPackagePurchaseCreateWithoutPackageInput[] | TrainingPackagePurchaseUncheckedCreateWithoutPackageInput[]
    connectOrCreate?: TrainingPackagePurchaseCreateOrConnectWithoutPackageInput | TrainingPackagePurchaseCreateOrConnectWithoutPackageInput[]
    upsert?: TrainingPackagePurchaseUpsertWithWhereUniqueWithoutPackageInput | TrainingPackagePurchaseUpsertWithWhereUniqueWithoutPackageInput[]
    createMany?: TrainingPackagePurchaseCreateManyPackageInputEnvelope
    set?: TrainingPackagePurchaseWhereUniqueInput | TrainingPackagePurchaseWhereUniqueInput[]
    disconnect?: TrainingPackagePurchaseWhereUniqueInput | TrainingPackagePurchaseWhereUniqueInput[]
    delete?: TrainingPackagePurchaseWhereUniqueInput | TrainingPackagePurchaseWhereUniqueInput[]
    connect?: TrainingPackagePurchaseWhereUniqueInput | TrainingPackagePurchaseWhereUniqueInput[]
    update?: TrainingPackagePurchaseUpdateWithWhereUniqueWithoutPackageInput | TrainingPackagePurchaseUpdateWithWhereUniqueWithoutPackageInput[]
    updateMany?: TrainingPackagePurchaseUpdateManyWithWhereWithoutPackageInput | TrainingPackagePurchaseUpdateManyWithWhereWithoutPackageInput[]
    deleteMany?: TrainingPackagePurchaseScalarWhereInput | TrainingPackagePurchaseScalarWhereInput[]
  }

  export type TrainingPackageCreateNestedOneWithoutPurchasesInput = {
    create?: XOR<TrainingPackageCreateWithoutPurchasesInput, TrainingPackageUncheckedCreateWithoutPurchasesInput>
    connectOrCreate?: TrainingPackageCreateOrConnectWithoutPurchasesInput
    connect?: TrainingPackageWhereUniqueInput
  }

  export type EnumTrainingPackagePurchaseStatusFieldUpdateOperationsInput = {
    set?: $Enums.TrainingPackagePurchaseStatus
  }

  export type TrainingPackageUpdateOneRequiredWithoutPurchasesNestedInput = {
    create?: XOR<TrainingPackageCreateWithoutPurchasesInput, TrainingPackageUncheckedCreateWithoutPurchasesInput>
    connectOrCreate?: TrainingPackageCreateOrConnectWithoutPurchasesInput
    upsert?: TrainingPackageUpsertWithoutPurchasesInput
    connect?: TrainingPackageWhereUniqueInput
    update?: XOR<XOR<TrainingPackageUpdateToOneWithWhereWithoutPurchasesInput, TrainingPackageUpdateWithoutPurchasesInput>, TrainingPackageUncheckedUpdateWithoutPurchasesInput>
  }

  export type KnowledgeDocumentCreateNestedManyWithoutSourceInput = {
    create?: XOR<KnowledgeDocumentCreateWithoutSourceInput, KnowledgeDocumentUncheckedCreateWithoutSourceInput> | KnowledgeDocumentCreateWithoutSourceInput[] | KnowledgeDocumentUncheckedCreateWithoutSourceInput[]
    connectOrCreate?: KnowledgeDocumentCreateOrConnectWithoutSourceInput | KnowledgeDocumentCreateOrConnectWithoutSourceInput[]
    createMany?: KnowledgeDocumentCreateManySourceInputEnvelope
    connect?: KnowledgeDocumentWhereUniqueInput | KnowledgeDocumentWhereUniqueInput[]
  }

  export type KnowledgeDocumentUncheckedCreateNestedManyWithoutSourceInput = {
    create?: XOR<KnowledgeDocumentCreateWithoutSourceInput, KnowledgeDocumentUncheckedCreateWithoutSourceInput> | KnowledgeDocumentCreateWithoutSourceInput[] | KnowledgeDocumentUncheckedCreateWithoutSourceInput[]
    connectOrCreate?: KnowledgeDocumentCreateOrConnectWithoutSourceInput | KnowledgeDocumentCreateOrConnectWithoutSourceInput[]
    createMany?: KnowledgeDocumentCreateManySourceInputEnvelope
    connect?: KnowledgeDocumentWhereUniqueInput | KnowledgeDocumentWhereUniqueInput[]
  }

  export type EnumKnowledgeSourceTypeFieldUpdateOperationsInput = {
    set?: $Enums.KnowledgeSourceType
  }

  export type KnowledgeDocumentUpdateManyWithoutSourceNestedInput = {
    create?: XOR<KnowledgeDocumentCreateWithoutSourceInput, KnowledgeDocumentUncheckedCreateWithoutSourceInput> | KnowledgeDocumentCreateWithoutSourceInput[] | KnowledgeDocumentUncheckedCreateWithoutSourceInput[]
    connectOrCreate?: KnowledgeDocumentCreateOrConnectWithoutSourceInput | KnowledgeDocumentCreateOrConnectWithoutSourceInput[]
    upsert?: KnowledgeDocumentUpsertWithWhereUniqueWithoutSourceInput | KnowledgeDocumentUpsertWithWhereUniqueWithoutSourceInput[]
    createMany?: KnowledgeDocumentCreateManySourceInputEnvelope
    set?: KnowledgeDocumentWhereUniqueInput | KnowledgeDocumentWhereUniqueInput[]
    disconnect?: KnowledgeDocumentWhereUniqueInput | KnowledgeDocumentWhereUniqueInput[]
    delete?: KnowledgeDocumentWhereUniqueInput | KnowledgeDocumentWhereUniqueInput[]
    connect?: KnowledgeDocumentWhereUniqueInput | KnowledgeDocumentWhereUniqueInput[]
    update?: KnowledgeDocumentUpdateWithWhereUniqueWithoutSourceInput | KnowledgeDocumentUpdateWithWhereUniqueWithoutSourceInput[]
    updateMany?: KnowledgeDocumentUpdateManyWithWhereWithoutSourceInput | KnowledgeDocumentUpdateManyWithWhereWithoutSourceInput[]
    deleteMany?: KnowledgeDocumentScalarWhereInput | KnowledgeDocumentScalarWhereInput[]
  }

  export type KnowledgeDocumentUncheckedUpdateManyWithoutSourceNestedInput = {
    create?: XOR<KnowledgeDocumentCreateWithoutSourceInput, KnowledgeDocumentUncheckedCreateWithoutSourceInput> | KnowledgeDocumentCreateWithoutSourceInput[] | KnowledgeDocumentUncheckedCreateWithoutSourceInput[]
    connectOrCreate?: KnowledgeDocumentCreateOrConnectWithoutSourceInput | KnowledgeDocumentCreateOrConnectWithoutSourceInput[]
    upsert?: KnowledgeDocumentUpsertWithWhereUniqueWithoutSourceInput | KnowledgeDocumentUpsertWithWhereUniqueWithoutSourceInput[]
    createMany?: KnowledgeDocumentCreateManySourceInputEnvelope
    set?: KnowledgeDocumentWhereUniqueInput | KnowledgeDocumentWhereUniqueInput[]
    disconnect?: KnowledgeDocumentWhereUniqueInput | KnowledgeDocumentWhereUniqueInput[]
    delete?: KnowledgeDocumentWhereUniqueInput | KnowledgeDocumentWhereUniqueInput[]
    connect?: KnowledgeDocumentWhereUniqueInput | KnowledgeDocumentWhereUniqueInput[]
    update?: KnowledgeDocumentUpdateWithWhereUniqueWithoutSourceInput | KnowledgeDocumentUpdateWithWhereUniqueWithoutSourceInput[]
    updateMany?: KnowledgeDocumentUpdateManyWithWhereWithoutSourceInput | KnowledgeDocumentUpdateManyWithWhereWithoutSourceInput[]
    deleteMany?: KnowledgeDocumentScalarWhereInput | KnowledgeDocumentScalarWhereInput[]
  }

  export type KnowledgeSourceCreateNestedOneWithoutDocumentsInput = {
    create?: XOR<KnowledgeSourceCreateWithoutDocumentsInput, KnowledgeSourceUncheckedCreateWithoutDocumentsInput>
    connectOrCreate?: KnowledgeSourceCreateOrConnectWithoutDocumentsInput
    connect?: KnowledgeSourceWhereUniqueInput
  }

  export type KnowledgeChunkCreateNestedManyWithoutDocumentInput = {
    create?: XOR<KnowledgeChunkCreateWithoutDocumentInput, KnowledgeChunkUncheckedCreateWithoutDocumentInput> | KnowledgeChunkCreateWithoutDocumentInput[] | KnowledgeChunkUncheckedCreateWithoutDocumentInput[]
    connectOrCreate?: KnowledgeChunkCreateOrConnectWithoutDocumentInput | KnowledgeChunkCreateOrConnectWithoutDocumentInput[]
    createMany?: KnowledgeChunkCreateManyDocumentInputEnvelope
    connect?: KnowledgeChunkWhereUniqueInput | KnowledgeChunkWhereUniqueInput[]
  }

  export type KnowledgeReviewItemCreateNestedManyWithoutDocumentInput = {
    create?: XOR<KnowledgeReviewItemCreateWithoutDocumentInput, KnowledgeReviewItemUncheckedCreateWithoutDocumentInput> | KnowledgeReviewItemCreateWithoutDocumentInput[] | KnowledgeReviewItemUncheckedCreateWithoutDocumentInput[]
    connectOrCreate?: KnowledgeReviewItemCreateOrConnectWithoutDocumentInput | KnowledgeReviewItemCreateOrConnectWithoutDocumentInput[]
    createMany?: KnowledgeReviewItemCreateManyDocumentInputEnvelope
    connect?: KnowledgeReviewItemWhereUniqueInput | KnowledgeReviewItemWhereUniqueInput[]
  }

  export type KnowledgeChunkUncheckedCreateNestedManyWithoutDocumentInput = {
    create?: XOR<KnowledgeChunkCreateWithoutDocumentInput, KnowledgeChunkUncheckedCreateWithoutDocumentInput> | KnowledgeChunkCreateWithoutDocumentInput[] | KnowledgeChunkUncheckedCreateWithoutDocumentInput[]
    connectOrCreate?: KnowledgeChunkCreateOrConnectWithoutDocumentInput | KnowledgeChunkCreateOrConnectWithoutDocumentInput[]
    createMany?: KnowledgeChunkCreateManyDocumentInputEnvelope
    connect?: KnowledgeChunkWhereUniqueInput | KnowledgeChunkWhereUniqueInput[]
  }

  export type KnowledgeReviewItemUncheckedCreateNestedManyWithoutDocumentInput = {
    create?: XOR<KnowledgeReviewItemCreateWithoutDocumentInput, KnowledgeReviewItemUncheckedCreateWithoutDocumentInput> | KnowledgeReviewItemCreateWithoutDocumentInput[] | KnowledgeReviewItemUncheckedCreateWithoutDocumentInput[]
    connectOrCreate?: KnowledgeReviewItemCreateOrConnectWithoutDocumentInput | KnowledgeReviewItemCreateOrConnectWithoutDocumentInput[]
    createMany?: KnowledgeReviewItemCreateManyDocumentInputEnvelope
    connect?: KnowledgeReviewItemWhereUniqueInput | KnowledgeReviewItemWhereUniqueInput[]
  }

  export type NullableEnumKnowledgeDocumentTopicFieldUpdateOperationsInput = {
    set?: $Enums.KnowledgeDocumentTopic | null
  }

  export type NullableDecimalFieldUpdateOperationsInput = {
    set?: Decimal | DecimalJsLike | number | string | null
    increment?: Decimal | DecimalJsLike | number | string
    decrement?: Decimal | DecimalJsLike | number | string
    multiply?: Decimal | DecimalJsLike | number | string
    divide?: Decimal | DecimalJsLike | number | string
  }

  export type EnumKnowledgeDocumentStatusFieldUpdateOperationsInput = {
    set?: $Enums.KnowledgeDocumentStatus
  }

  export type KnowledgeSourceUpdateOneRequiredWithoutDocumentsNestedInput = {
    create?: XOR<KnowledgeSourceCreateWithoutDocumentsInput, KnowledgeSourceUncheckedCreateWithoutDocumentsInput>
    connectOrCreate?: KnowledgeSourceCreateOrConnectWithoutDocumentsInput
    upsert?: KnowledgeSourceUpsertWithoutDocumentsInput
    connect?: KnowledgeSourceWhereUniqueInput
    update?: XOR<XOR<KnowledgeSourceUpdateToOneWithWhereWithoutDocumentsInput, KnowledgeSourceUpdateWithoutDocumentsInput>, KnowledgeSourceUncheckedUpdateWithoutDocumentsInput>
  }

  export type KnowledgeChunkUpdateManyWithoutDocumentNestedInput = {
    create?: XOR<KnowledgeChunkCreateWithoutDocumentInput, KnowledgeChunkUncheckedCreateWithoutDocumentInput> | KnowledgeChunkCreateWithoutDocumentInput[] | KnowledgeChunkUncheckedCreateWithoutDocumentInput[]
    connectOrCreate?: KnowledgeChunkCreateOrConnectWithoutDocumentInput | KnowledgeChunkCreateOrConnectWithoutDocumentInput[]
    upsert?: KnowledgeChunkUpsertWithWhereUniqueWithoutDocumentInput | KnowledgeChunkUpsertWithWhereUniqueWithoutDocumentInput[]
    createMany?: KnowledgeChunkCreateManyDocumentInputEnvelope
    set?: KnowledgeChunkWhereUniqueInput | KnowledgeChunkWhereUniqueInput[]
    disconnect?: KnowledgeChunkWhereUniqueInput | KnowledgeChunkWhereUniqueInput[]
    delete?: KnowledgeChunkWhereUniqueInput | KnowledgeChunkWhereUniqueInput[]
    connect?: KnowledgeChunkWhereUniqueInput | KnowledgeChunkWhereUniqueInput[]
    update?: KnowledgeChunkUpdateWithWhereUniqueWithoutDocumentInput | KnowledgeChunkUpdateWithWhereUniqueWithoutDocumentInput[]
    updateMany?: KnowledgeChunkUpdateManyWithWhereWithoutDocumentInput | KnowledgeChunkUpdateManyWithWhereWithoutDocumentInput[]
    deleteMany?: KnowledgeChunkScalarWhereInput | KnowledgeChunkScalarWhereInput[]
  }

  export type KnowledgeReviewItemUpdateManyWithoutDocumentNestedInput = {
    create?: XOR<KnowledgeReviewItemCreateWithoutDocumentInput, KnowledgeReviewItemUncheckedCreateWithoutDocumentInput> | KnowledgeReviewItemCreateWithoutDocumentInput[] | KnowledgeReviewItemUncheckedCreateWithoutDocumentInput[]
    connectOrCreate?: KnowledgeReviewItemCreateOrConnectWithoutDocumentInput | KnowledgeReviewItemCreateOrConnectWithoutDocumentInput[]
    upsert?: KnowledgeReviewItemUpsertWithWhereUniqueWithoutDocumentInput | KnowledgeReviewItemUpsertWithWhereUniqueWithoutDocumentInput[]
    createMany?: KnowledgeReviewItemCreateManyDocumentInputEnvelope
    set?: KnowledgeReviewItemWhereUniqueInput | KnowledgeReviewItemWhereUniqueInput[]
    disconnect?: KnowledgeReviewItemWhereUniqueInput | KnowledgeReviewItemWhereUniqueInput[]
    delete?: KnowledgeReviewItemWhereUniqueInput | KnowledgeReviewItemWhereUniqueInput[]
    connect?: KnowledgeReviewItemWhereUniqueInput | KnowledgeReviewItemWhereUniqueInput[]
    update?: KnowledgeReviewItemUpdateWithWhereUniqueWithoutDocumentInput | KnowledgeReviewItemUpdateWithWhereUniqueWithoutDocumentInput[]
    updateMany?: KnowledgeReviewItemUpdateManyWithWhereWithoutDocumentInput | KnowledgeReviewItemUpdateManyWithWhereWithoutDocumentInput[]
    deleteMany?: KnowledgeReviewItemScalarWhereInput | KnowledgeReviewItemScalarWhereInput[]
  }

  export type KnowledgeChunkUncheckedUpdateManyWithoutDocumentNestedInput = {
    create?: XOR<KnowledgeChunkCreateWithoutDocumentInput, KnowledgeChunkUncheckedCreateWithoutDocumentInput> | KnowledgeChunkCreateWithoutDocumentInput[] | KnowledgeChunkUncheckedCreateWithoutDocumentInput[]
    connectOrCreate?: KnowledgeChunkCreateOrConnectWithoutDocumentInput | KnowledgeChunkCreateOrConnectWithoutDocumentInput[]
    upsert?: KnowledgeChunkUpsertWithWhereUniqueWithoutDocumentInput | KnowledgeChunkUpsertWithWhereUniqueWithoutDocumentInput[]
    createMany?: KnowledgeChunkCreateManyDocumentInputEnvelope
    set?: KnowledgeChunkWhereUniqueInput | KnowledgeChunkWhereUniqueInput[]
    disconnect?: KnowledgeChunkWhereUniqueInput | KnowledgeChunkWhereUniqueInput[]
    delete?: KnowledgeChunkWhereUniqueInput | KnowledgeChunkWhereUniqueInput[]
    connect?: KnowledgeChunkWhereUniqueInput | KnowledgeChunkWhereUniqueInput[]
    update?: KnowledgeChunkUpdateWithWhereUniqueWithoutDocumentInput | KnowledgeChunkUpdateWithWhereUniqueWithoutDocumentInput[]
    updateMany?: KnowledgeChunkUpdateManyWithWhereWithoutDocumentInput | KnowledgeChunkUpdateManyWithWhereWithoutDocumentInput[]
    deleteMany?: KnowledgeChunkScalarWhereInput | KnowledgeChunkScalarWhereInput[]
  }

  export type KnowledgeReviewItemUncheckedUpdateManyWithoutDocumentNestedInput = {
    create?: XOR<KnowledgeReviewItemCreateWithoutDocumentInput, KnowledgeReviewItemUncheckedCreateWithoutDocumentInput> | KnowledgeReviewItemCreateWithoutDocumentInput[] | KnowledgeReviewItemUncheckedCreateWithoutDocumentInput[]
    connectOrCreate?: KnowledgeReviewItemCreateOrConnectWithoutDocumentInput | KnowledgeReviewItemCreateOrConnectWithoutDocumentInput[]
    upsert?: KnowledgeReviewItemUpsertWithWhereUniqueWithoutDocumentInput | KnowledgeReviewItemUpsertWithWhereUniqueWithoutDocumentInput[]
    createMany?: KnowledgeReviewItemCreateManyDocumentInputEnvelope
    set?: KnowledgeReviewItemWhereUniqueInput | KnowledgeReviewItemWhereUniqueInput[]
    disconnect?: KnowledgeReviewItemWhereUniqueInput | KnowledgeReviewItemWhereUniqueInput[]
    delete?: KnowledgeReviewItemWhereUniqueInput | KnowledgeReviewItemWhereUniqueInput[]
    connect?: KnowledgeReviewItemWhereUniqueInput | KnowledgeReviewItemWhereUniqueInput[]
    update?: KnowledgeReviewItemUpdateWithWhereUniqueWithoutDocumentInput | KnowledgeReviewItemUpdateWithWhereUniqueWithoutDocumentInput[]
    updateMany?: KnowledgeReviewItemUpdateManyWithWhereWithoutDocumentInput | KnowledgeReviewItemUpdateManyWithWhereWithoutDocumentInput[]
    deleteMany?: KnowledgeReviewItemScalarWhereInput | KnowledgeReviewItemScalarWhereInput[]
  }

  export type KnowledgeDocumentCreateNestedOneWithoutChunksInput = {
    create?: XOR<KnowledgeDocumentCreateWithoutChunksInput, KnowledgeDocumentUncheckedCreateWithoutChunksInput>
    connectOrCreate?: KnowledgeDocumentCreateOrConnectWithoutChunksInput
    connect?: KnowledgeDocumentWhereUniqueInput
  }

  export type KnowledgeDocumentUpdateOneRequiredWithoutChunksNestedInput = {
    create?: XOR<KnowledgeDocumentCreateWithoutChunksInput, KnowledgeDocumentUncheckedCreateWithoutChunksInput>
    connectOrCreate?: KnowledgeDocumentCreateOrConnectWithoutChunksInput
    upsert?: KnowledgeDocumentUpsertWithoutChunksInput
    connect?: KnowledgeDocumentWhereUniqueInput
    update?: XOR<XOR<KnowledgeDocumentUpdateToOneWithWhereWithoutChunksInput, KnowledgeDocumentUpdateWithoutChunksInput>, KnowledgeDocumentUncheckedUpdateWithoutChunksInput>
  }

  export type EnumKnowledgePipelineRunStatusFieldUpdateOperationsInput = {
    set?: $Enums.KnowledgePipelineRunStatus
  }

  export type KnowledgeDocumentCreateNestedOneWithoutReviewItemsInput = {
    create?: XOR<KnowledgeDocumentCreateWithoutReviewItemsInput, KnowledgeDocumentUncheckedCreateWithoutReviewItemsInput>
    connectOrCreate?: KnowledgeDocumentCreateOrConnectWithoutReviewItemsInput
    connect?: KnowledgeDocumentWhereUniqueInput
  }

  export type EnumKnowledgeReviewStatusFieldUpdateOperationsInput = {
    set?: $Enums.KnowledgeReviewStatus
  }

  export type KnowledgeDocumentUpdateOneRequiredWithoutReviewItemsNestedInput = {
    create?: XOR<KnowledgeDocumentCreateWithoutReviewItemsInput, KnowledgeDocumentUncheckedCreateWithoutReviewItemsInput>
    connectOrCreate?: KnowledgeDocumentCreateOrConnectWithoutReviewItemsInput
    upsert?: KnowledgeDocumentUpsertWithoutReviewItemsInput
    connect?: KnowledgeDocumentWhereUniqueInput
    update?: XOR<XOR<KnowledgeDocumentUpdateToOneWithWhereWithoutReviewItemsInput, KnowledgeDocumentUpdateWithoutReviewItemsInput>, KnowledgeDocumentUncheckedUpdateWithoutReviewItemsInput>
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

  export type NestedEnumPlanStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.PlanStatus | EnumPlanStatusFieldRefInput<$PrismaModel>
    in?: $Enums.PlanStatus[] | ListEnumPlanStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.PlanStatus[] | ListEnumPlanStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumPlanStatusFilter<$PrismaModel> | $Enums.PlanStatus
  }

  export type NestedEnumPtReviewStatusNullableFilter<$PrismaModel = never> = {
    equals?: $Enums.PtReviewStatus | EnumPtReviewStatusFieldRefInput<$PrismaModel> | null
    in?: $Enums.PtReviewStatus[] | ListEnumPtReviewStatusFieldRefInput<$PrismaModel> | null
    notIn?: $Enums.PtReviewStatus[] | ListEnumPtReviewStatusFieldRefInput<$PrismaModel> | null
    not?: NestedEnumPtReviewStatusNullableFilter<$PrismaModel> | $Enums.PtReviewStatus | null
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

  export type NestedEnumPlanStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.PlanStatus | EnumPlanStatusFieldRefInput<$PrismaModel>
    in?: $Enums.PlanStatus[] | ListEnumPlanStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.PlanStatus[] | ListEnumPlanStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumPlanStatusWithAggregatesFilter<$PrismaModel> | $Enums.PlanStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumPlanStatusFilter<$PrismaModel>
    _max?: NestedEnumPlanStatusFilter<$PrismaModel>
  }

  export type NestedEnumPtReviewStatusNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.PtReviewStatus | EnumPtReviewStatusFieldRefInput<$PrismaModel> | null
    in?: $Enums.PtReviewStatus[] | ListEnumPtReviewStatusFieldRefInput<$PrismaModel> | null
    notIn?: $Enums.PtReviewStatus[] | ListEnumPtReviewStatusFieldRefInput<$PrismaModel> | null
    not?: NestedEnumPtReviewStatusNullableWithAggregatesFilter<$PrismaModel> | $Enums.PtReviewStatus | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedEnumPtReviewStatusNullableFilter<$PrismaModel>
    _max?: NestedEnumPtReviewStatusNullableFilter<$PrismaModel>
  }

  export type NestedEnumPublishModerationStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.PublishModerationStatus | EnumPublishModerationStatusFieldRefInput<$PrismaModel>
    in?: $Enums.PublishModerationStatus[] | ListEnumPublishModerationStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.PublishModerationStatus[] | ListEnumPublishModerationStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumPublishModerationStatusFilter<$PrismaModel> | $Enums.PublishModerationStatus
  }

  export type NestedEnumPublishModerationStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.PublishModerationStatus | EnumPublishModerationStatusFieldRefInput<$PrismaModel>
    in?: $Enums.PublishModerationStatus[] | ListEnumPublishModerationStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.PublishModerationStatus[] | ListEnumPublishModerationStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumPublishModerationStatusWithAggregatesFilter<$PrismaModel> | $Enums.PublishModerationStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumPublishModerationStatusFilter<$PrismaModel>
    _max?: NestedEnumPublishModerationStatusFilter<$PrismaModel>
  }

  export type NestedEnumTrainingPackageStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.TrainingPackageStatus | EnumTrainingPackageStatusFieldRefInput<$PrismaModel>
    in?: $Enums.TrainingPackageStatus[] | ListEnumTrainingPackageStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.TrainingPackageStatus[] | ListEnumTrainingPackageStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumTrainingPackageStatusFilter<$PrismaModel> | $Enums.TrainingPackageStatus
  }

  export type NestedEnumTrainingPackageStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.TrainingPackageStatus | EnumTrainingPackageStatusFieldRefInput<$PrismaModel>
    in?: $Enums.TrainingPackageStatus[] | ListEnumTrainingPackageStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.TrainingPackageStatus[] | ListEnumTrainingPackageStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumTrainingPackageStatusWithAggregatesFilter<$PrismaModel> | $Enums.TrainingPackageStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumTrainingPackageStatusFilter<$PrismaModel>
    _max?: NestedEnumTrainingPackageStatusFilter<$PrismaModel>
  }

  export type NestedEnumTrainingPackagePurchaseStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.TrainingPackagePurchaseStatus | EnumTrainingPackagePurchaseStatusFieldRefInput<$PrismaModel>
    in?: $Enums.TrainingPackagePurchaseStatus[] | ListEnumTrainingPackagePurchaseStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.TrainingPackagePurchaseStatus[] | ListEnumTrainingPackagePurchaseStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumTrainingPackagePurchaseStatusFilter<$PrismaModel> | $Enums.TrainingPackagePurchaseStatus
  }

  export type NestedEnumTrainingPackagePurchaseStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.TrainingPackagePurchaseStatus | EnumTrainingPackagePurchaseStatusFieldRefInput<$PrismaModel>
    in?: $Enums.TrainingPackagePurchaseStatus[] | ListEnumTrainingPackagePurchaseStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.TrainingPackagePurchaseStatus[] | ListEnumTrainingPackagePurchaseStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumTrainingPackagePurchaseStatusWithAggregatesFilter<$PrismaModel> | $Enums.TrainingPackagePurchaseStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumTrainingPackagePurchaseStatusFilter<$PrismaModel>
    _max?: NestedEnumTrainingPackagePurchaseStatusFilter<$PrismaModel>
  }

  export type NestedEnumKnowledgeSourceTypeFilter<$PrismaModel = never> = {
    equals?: $Enums.KnowledgeSourceType | EnumKnowledgeSourceTypeFieldRefInput<$PrismaModel>
    in?: $Enums.KnowledgeSourceType[] | ListEnumKnowledgeSourceTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.KnowledgeSourceType[] | ListEnumKnowledgeSourceTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumKnowledgeSourceTypeFilter<$PrismaModel> | $Enums.KnowledgeSourceType
  }

  export type NestedEnumKnowledgeSourceTypeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.KnowledgeSourceType | EnumKnowledgeSourceTypeFieldRefInput<$PrismaModel>
    in?: $Enums.KnowledgeSourceType[] | ListEnumKnowledgeSourceTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.KnowledgeSourceType[] | ListEnumKnowledgeSourceTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumKnowledgeSourceTypeWithAggregatesFilter<$PrismaModel> | $Enums.KnowledgeSourceType
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumKnowledgeSourceTypeFilter<$PrismaModel>
    _max?: NestedEnumKnowledgeSourceTypeFilter<$PrismaModel>
  }

  export type NestedEnumKnowledgeDocumentTopicNullableFilter<$PrismaModel = never> = {
    equals?: $Enums.KnowledgeDocumentTopic | EnumKnowledgeDocumentTopicFieldRefInput<$PrismaModel> | null
    in?: $Enums.KnowledgeDocumentTopic[] | ListEnumKnowledgeDocumentTopicFieldRefInput<$PrismaModel> | null
    notIn?: $Enums.KnowledgeDocumentTopic[] | ListEnumKnowledgeDocumentTopicFieldRefInput<$PrismaModel> | null
    not?: NestedEnumKnowledgeDocumentTopicNullableFilter<$PrismaModel> | $Enums.KnowledgeDocumentTopic | null
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

  export type NestedEnumKnowledgeDocumentStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.KnowledgeDocumentStatus | EnumKnowledgeDocumentStatusFieldRefInput<$PrismaModel>
    in?: $Enums.KnowledgeDocumentStatus[] | ListEnumKnowledgeDocumentStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.KnowledgeDocumentStatus[] | ListEnumKnowledgeDocumentStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumKnowledgeDocumentStatusFilter<$PrismaModel> | $Enums.KnowledgeDocumentStatus
  }

  export type NestedEnumKnowledgeDocumentTopicNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.KnowledgeDocumentTopic | EnumKnowledgeDocumentTopicFieldRefInput<$PrismaModel> | null
    in?: $Enums.KnowledgeDocumentTopic[] | ListEnumKnowledgeDocumentTopicFieldRefInput<$PrismaModel> | null
    notIn?: $Enums.KnowledgeDocumentTopic[] | ListEnumKnowledgeDocumentTopicFieldRefInput<$PrismaModel> | null
    not?: NestedEnumKnowledgeDocumentTopicNullableWithAggregatesFilter<$PrismaModel> | $Enums.KnowledgeDocumentTopic | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedEnumKnowledgeDocumentTopicNullableFilter<$PrismaModel>
    _max?: NestedEnumKnowledgeDocumentTopicNullableFilter<$PrismaModel>
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

  export type NestedEnumKnowledgeDocumentStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.KnowledgeDocumentStatus | EnumKnowledgeDocumentStatusFieldRefInput<$PrismaModel>
    in?: $Enums.KnowledgeDocumentStatus[] | ListEnumKnowledgeDocumentStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.KnowledgeDocumentStatus[] | ListEnumKnowledgeDocumentStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumKnowledgeDocumentStatusWithAggregatesFilter<$PrismaModel> | $Enums.KnowledgeDocumentStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumKnowledgeDocumentStatusFilter<$PrismaModel>
    _max?: NestedEnumKnowledgeDocumentStatusFilter<$PrismaModel>
  }

  export type NestedEnumKnowledgePipelineRunStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.KnowledgePipelineRunStatus | EnumKnowledgePipelineRunStatusFieldRefInput<$PrismaModel>
    in?: $Enums.KnowledgePipelineRunStatus[] | ListEnumKnowledgePipelineRunStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.KnowledgePipelineRunStatus[] | ListEnumKnowledgePipelineRunStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumKnowledgePipelineRunStatusFilter<$PrismaModel> | $Enums.KnowledgePipelineRunStatus
  }

  export type NestedEnumKnowledgePipelineRunStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.KnowledgePipelineRunStatus | EnumKnowledgePipelineRunStatusFieldRefInput<$PrismaModel>
    in?: $Enums.KnowledgePipelineRunStatus[] | ListEnumKnowledgePipelineRunStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.KnowledgePipelineRunStatus[] | ListEnumKnowledgePipelineRunStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumKnowledgePipelineRunStatusWithAggregatesFilter<$PrismaModel> | $Enums.KnowledgePipelineRunStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumKnowledgePipelineRunStatusFilter<$PrismaModel>
    _max?: NestedEnumKnowledgePipelineRunStatusFilter<$PrismaModel>
  }

  export type NestedEnumKnowledgeReviewStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.KnowledgeReviewStatus | EnumKnowledgeReviewStatusFieldRefInput<$PrismaModel>
    in?: $Enums.KnowledgeReviewStatus[] | ListEnumKnowledgeReviewStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.KnowledgeReviewStatus[] | ListEnumKnowledgeReviewStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumKnowledgeReviewStatusFilter<$PrismaModel> | $Enums.KnowledgeReviewStatus
  }

  export type NestedEnumKnowledgeReviewStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.KnowledgeReviewStatus | EnumKnowledgeReviewStatusFieldRefInput<$PrismaModel>
    in?: $Enums.KnowledgeReviewStatus[] | ListEnumKnowledgeReviewStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.KnowledgeReviewStatus[] | ListEnumKnowledgeReviewStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumKnowledgeReviewStatusWithAggregatesFilter<$PrismaModel> | $Enums.KnowledgeReviewStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumKnowledgeReviewStatusFilter<$PrismaModel>
    _max?: NestedEnumKnowledgeReviewStatusFilter<$PrismaModel>
  }

  export type PublishedPlanCreateWithoutSourcePlanInput = {
    id?: string
    publisherId: string
    title: string
    description?: string | null
    goal: string
    moderationStatus?: $Enums.PublishModerationStatus
    moderationNote?: string | null
    avgRating?: number
    ratingCount?: number
    publishedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    reviews?: PlanReviewCreateNestedManyWithoutPublishedPlanInput
    packages?: TrainingPackageCreateNestedManyWithoutPublishedPlanInput
  }

  export type PublishedPlanUncheckedCreateWithoutSourcePlanInput = {
    id?: string
    publisherId: string
    title: string
    description?: string | null
    goal: string
    moderationStatus?: $Enums.PublishModerationStatus
    moderationNote?: string | null
    avgRating?: number
    ratingCount?: number
    publishedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    reviews?: PlanReviewUncheckedCreateNestedManyWithoutPublishedPlanInput
    packages?: TrainingPackageUncheckedCreateNestedManyWithoutPublishedPlanInput
  }

  export type PublishedPlanCreateOrConnectWithoutSourcePlanInput = {
    where: PublishedPlanWhereUniqueInput
    create: XOR<PublishedPlanCreateWithoutSourcePlanInput, PublishedPlanUncheckedCreateWithoutSourcePlanInput>
  }

  export type PublishedPlanCreateManySourcePlanInputEnvelope = {
    data: PublishedPlanCreateManySourcePlanInput | PublishedPlanCreateManySourcePlanInput[]
    skipDuplicates?: boolean
  }

  export type PublishedPlanUpsertWithWhereUniqueWithoutSourcePlanInput = {
    where: PublishedPlanWhereUniqueInput
    update: XOR<PublishedPlanUpdateWithoutSourcePlanInput, PublishedPlanUncheckedUpdateWithoutSourcePlanInput>
    create: XOR<PublishedPlanCreateWithoutSourcePlanInput, PublishedPlanUncheckedCreateWithoutSourcePlanInput>
  }

  export type PublishedPlanUpdateWithWhereUniqueWithoutSourcePlanInput = {
    where: PublishedPlanWhereUniqueInput
    data: XOR<PublishedPlanUpdateWithoutSourcePlanInput, PublishedPlanUncheckedUpdateWithoutSourcePlanInput>
  }

  export type PublishedPlanUpdateManyWithWhereWithoutSourcePlanInput = {
    where: PublishedPlanScalarWhereInput
    data: XOR<PublishedPlanUpdateManyMutationInput, PublishedPlanUncheckedUpdateManyWithoutSourcePlanInput>
  }

  export type PublishedPlanScalarWhereInput = {
    AND?: PublishedPlanScalarWhereInput | PublishedPlanScalarWhereInput[]
    OR?: PublishedPlanScalarWhereInput[]
    NOT?: PublishedPlanScalarWhereInput | PublishedPlanScalarWhereInput[]
    id?: StringFilter<"PublishedPlan"> | string
    sourcePlanId?: StringFilter<"PublishedPlan"> | string
    publisherId?: StringFilter<"PublishedPlan"> | string
    title?: StringFilter<"PublishedPlan"> | string
    description?: StringNullableFilter<"PublishedPlan"> | string | null
    goal?: StringFilter<"PublishedPlan"> | string
    moderationStatus?: EnumPublishModerationStatusFilter<"PublishedPlan"> | $Enums.PublishModerationStatus
    moderationNote?: StringNullableFilter<"PublishedPlan"> | string | null
    avgRating?: FloatFilter<"PublishedPlan"> | number
    ratingCount?: IntFilter<"PublishedPlan"> | number
    publishedAt?: DateTimeNullableFilter<"PublishedPlan"> | Date | string | null
    createdAt?: DateTimeFilter<"PublishedPlan"> | Date | string
    updatedAt?: DateTimeFilter<"PublishedPlan"> | Date | string
  }

  export type WorkoutPlanCreateWithoutPublishedListingsInput = {
    id?: string
    userId: string
    name: string
    description?: string | null
    goal: string
    duration: number
    daysPerWeek: number
    plan: JsonNullValueInput | InputJsonValue
    status?: $Enums.PlanStatus
    version?: number
    jobId?: string | null
    failReason?: string | null
    ptUserId?: string | null
    ptName?: string | null
    clientName?: string | null
    ptReviewStatus?: $Enums.PtReviewStatus | null
    ptNote?: string | null
    ptReviewedAt?: Date | string | null
    archivedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type WorkoutPlanUncheckedCreateWithoutPublishedListingsInput = {
    id?: string
    userId: string
    name: string
    description?: string | null
    goal: string
    duration: number
    daysPerWeek: number
    plan: JsonNullValueInput | InputJsonValue
    status?: $Enums.PlanStatus
    version?: number
    jobId?: string | null
    failReason?: string | null
    ptUserId?: string | null
    ptName?: string | null
    clientName?: string | null
    ptReviewStatus?: $Enums.PtReviewStatus | null
    ptNote?: string | null
    ptReviewedAt?: Date | string | null
    archivedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type WorkoutPlanCreateOrConnectWithoutPublishedListingsInput = {
    where: WorkoutPlanWhereUniqueInput
    create: XOR<WorkoutPlanCreateWithoutPublishedListingsInput, WorkoutPlanUncheckedCreateWithoutPublishedListingsInput>
  }

  export type PlanReviewCreateWithoutPublishedPlanInput = {
    id?: string
    reviewerId: string
    rating: number
    comment?: string | null
    createdAt?: Date | string
  }

  export type PlanReviewUncheckedCreateWithoutPublishedPlanInput = {
    id?: string
    reviewerId: string
    rating: number
    comment?: string | null
    createdAt?: Date | string
  }

  export type PlanReviewCreateOrConnectWithoutPublishedPlanInput = {
    where: PlanReviewWhereUniqueInput
    create: XOR<PlanReviewCreateWithoutPublishedPlanInput, PlanReviewUncheckedCreateWithoutPublishedPlanInput>
  }

  export type PlanReviewCreateManyPublishedPlanInputEnvelope = {
    data: PlanReviewCreateManyPublishedPlanInput | PlanReviewCreateManyPublishedPlanInput[]
    skipDuplicates?: boolean
  }

  export type TrainingPackageCreateWithoutPublishedPlanInput = {
    id?: string
    sellerId: string
    name: string
    description?: string | null
    price: number
    durationWeeks?: number | null
    status?: $Enums.TrainingPackageStatus
    createdAt?: Date | string
    updatedAt?: Date | string
    purchases?: TrainingPackagePurchaseCreateNestedManyWithoutPackageInput
  }

  export type TrainingPackageUncheckedCreateWithoutPublishedPlanInput = {
    id?: string
    sellerId: string
    name: string
    description?: string | null
    price: number
    durationWeeks?: number | null
    status?: $Enums.TrainingPackageStatus
    createdAt?: Date | string
    updatedAt?: Date | string
    purchases?: TrainingPackagePurchaseUncheckedCreateNestedManyWithoutPackageInput
  }

  export type TrainingPackageCreateOrConnectWithoutPublishedPlanInput = {
    where: TrainingPackageWhereUniqueInput
    create: XOR<TrainingPackageCreateWithoutPublishedPlanInput, TrainingPackageUncheckedCreateWithoutPublishedPlanInput>
  }

  export type TrainingPackageCreateManyPublishedPlanInputEnvelope = {
    data: TrainingPackageCreateManyPublishedPlanInput | TrainingPackageCreateManyPublishedPlanInput[]
    skipDuplicates?: boolean
  }

  export type WorkoutPlanUpsertWithoutPublishedListingsInput = {
    update: XOR<WorkoutPlanUpdateWithoutPublishedListingsInput, WorkoutPlanUncheckedUpdateWithoutPublishedListingsInput>
    create: XOR<WorkoutPlanCreateWithoutPublishedListingsInput, WorkoutPlanUncheckedCreateWithoutPublishedListingsInput>
    where?: WorkoutPlanWhereInput
  }

  export type WorkoutPlanUpdateToOneWithWhereWithoutPublishedListingsInput = {
    where?: WorkoutPlanWhereInput
    data: XOR<WorkoutPlanUpdateWithoutPublishedListingsInput, WorkoutPlanUncheckedUpdateWithoutPublishedListingsInput>
  }

  export type WorkoutPlanUpdateWithoutPublishedListingsInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    goal?: StringFieldUpdateOperationsInput | string
    duration?: IntFieldUpdateOperationsInput | number
    daysPerWeek?: IntFieldUpdateOperationsInput | number
    plan?: JsonNullValueInput | InputJsonValue
    status?: EnumPlanStatusFieldUpdateOperationsInput | $Enums.PlanStatus
    version?: IntFieldUpdateOperationsInput | number
    jobId?: NullableStringFieldUpdateOperationsInput | string | null
    failReason?: NullableStringFieldUpdateOperationsInput | string | null
    ptUserId?: NullableStringFieldUpdateOperationsInput | string | null
    ptName?: NullableStringFieldUpdateOperationsInput | string | null
    clientName?: NullableStringFieldUpdateOperationsInput | string | null
    ptReviewStatus?: NullableEnumPtReviewStatusFieldUpdateOperationsInput | $Enums.PtReviewStatus | null
    ptNote?: NullableStringFieldUpdateOperationsInput | string | null
    ptReviewedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    archivedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type WorkoutPlanUncheckedUpdateWithoutPublishedListingsInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    goal?: StringFieldUpdateOperationsInput | string
    duration?: IntFieldUpdateOperationsInput | number
    daysPerWeek?: IntFieldUpdateOperationsInput | number
    plan?: JsonNullValueInput | InputJsonValue
    status?: EnumPlanStatusFieldUpdateOperationsInput | $Enums.PlanStatus
    version?: IntFieldUpdateOperationsInput | number
    jobId?: NullableStringFieldUpdateOperationsInput | string | null
    failReason?: NullableStringFieldUpdateOperationsInput | string | null
    ptUserId?: NullableStringFieldUpdateOperationsInput | string | null
    ptName?: NullableStringFieldUpdateOperationsInput | string | null
    clientName?: NullableStringFieldUpdateOperationsInput | string | null
    ptReviewStatus?: NullableEnumPtReviewStatusFieldUpdateOperationsInput | $Enums.PtReviewStatus | null
    ptNote?: NullableStringFieldUpdateOperationsInput | string | null
    ptReviewedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    archivedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PlanReviewUpsertWithWhereUniqueWithoutPublishedPlanInput = {
    where: PlanReviewWhereUniqueInput
    update: XOR<PlanReviewUpdateWithoutPublishedPlanInput, PlanReviewUncheckedUpdateWithoutPublishedPlanInput>
    create: XOR<PlanReviewCreateWithoutPublishedPlanInput, PlanReviewUncheckedCreateWithoutPublishedPlanInput>
  }

  export type PlanReviewUpdateWithWhereUniqueWithoutPublishedPlanInput = {
    where: PlanReviewWhereUniqueInput
    data: XOR<PlanReviewUpdateWithoutPublishedPlanInput, PlanReviewUncheckedUpdateWithoutPublishedPlanInput>
  }

  export type PlanReviewUpdateManyWithWhereWithoutPublishedPlanInput = {
    where: PlanReviewScalarWhereInput
    data: XOR<PlanReviewUpdateManyMutationInput, PlanReviewUncheckedUpdateManyWithoutPublishedPlanInput>
  }

  export type PlanReviewScalarWhereInput = {
    AND?: PlanReviewScalarWhereInput | PlanReviewScalarWhereInput[]
    OR?: PlanReviewScalarWhereInput[]
    NOT?: PlanReviewScalarWhereInput | PlanReviewScalarWhereInput[]
    id?: StringFilter<"PlanReview"> | string
    publishedPlanId?: StringFilter<"PlanReview"> | string
    reviewerId?: StringFilter<"PlanReview"> | string
    rating?: IntFilter<"PlanReview"> | number
    comment?: StringNullableFilter<"PlanReview"> | string | null
    createdAt?: DateTimeFilter<"PlanReview"> | Date | string
  }

  export type TrainingPackageUpsertWithWhereUniqueWithoutPublishedPlanInput = {
    where: TrainingPackageWhereUniqueInput
    update: XOR<TrainingPackageUpdateWithoutPublishedPlanInput, TrainingPackageUncheckedUpdateWithoutPublishedPlanInput>
    create: XOR<TrainingPackageCreateWithoutPublishedPlanInput, TrainingPackageUncheckedCreateWithoutPublishedPlanInput>
  }

  export type TrainingPackageUpdateWithWhereUniqueWithoutPublishedPlanInput = {
    where: TrainingPackageWhereUniqueInput
    data: XOR<TrainingPackageUpdateWithoutPublishedPlanInput, TrainingPackageUncheckedUpdateWithoutPublishedPlanInput>
  }

  export type TrainingPackageUpdateManyWithWhereWithoutPublishedPlanInput = {
    where: TrainingPackageScalarWhereInput
    data: XOR<TrainingPackageUpdateManyMutationInput, TrainingPackageUncheckedUpdateManyWithoutPublishedPlanInput>
  }

  export type TrainingPackageScalarWhereInput = {
    AND?: TrainingPackageScalarWhereInput | TrainingPackageScalarWhereInput[]
    OR?: TrainingPackageScalarWhereInput[]
    NOT?: TrainingPackageScalarWhereInput | TrainingPackageScalarWhereInput[]
    id?: StringFilter<"TrainingPackage"> | string
    sellerId?: StringFilter<"TrainingPackage"> | string
    publishedPlanId?: StringFilter<"TrainingPackage"> | string
    name?: StringFilter<"TrainingPackage"> | string
    description?: StringNullableFilter<"TrainingPackage"> | string | null
    price?: FloatFilter<"TrainingPackage"> | number
    durationWeeks?: IntNullableFilter<"TrainingPackage"> | number | null
    status?: EnumTrainingPackageStatusFilter<"TrainingPackage"> | $Enums.TrainingPackageStatus
    createdAt?: DateTimeFilter<"TrainingPackage"> | Date | string
    updatedAt?: DateTimeFilter<"TrainingPackage"> | Date | string
  }

  export type PublishedPlanCreateWithoutReviewsInput = {
    id?: string
    publisherId: string
    title: string
    description?: string | null
    goal: string
    moderationStatus?: $Enums.PublishModerationStatus
    moderationNote?: string | null
    avgRating?: number
    ratingCount?: number
    publishedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    sourcePlan: WorkoutPlanCreateNestedOneWithoutPublishedListingsInput
    packages?: TrainingPackageCreateNestedManyWithoutPublishedPlanInput
  }

  export type PublishedPlanUncheckedCreateWithoutReviewsInput = {
    id?: string
    sourcePlanId: string
    publisherId: string
    title: string
    description?: string | null
    goal: string
    moderationStatus?: $Enums.PublishModerationStatus
    moderationNote?: string | null
    avgRating?: number
    ratingCount?: number
    publishedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    packages?: TrainingPackageUncheckedCreateNestedManyWithoutPublishedPlanInput
  }

  export type PublishedPlanCreateOrConnectWithoutReviewsInput = {
    where: PublishedPlanWhereUniqueInput
    create: XOR<PublishedPlanCreateWithoutReviewsInput, PublishedPlanUncheckedCreateWithoutReviewsInput>
  }

  export type PublishedPlanUpsertWithoutReviewsInput = {
    update: XOR<PublishedPlanUpdateWithoutReviewsInput, PublishedPlanUncheckedUpdateWithoutReviewsInput>
    create: XOR<PublishedPlanCreateWithoutReviewsInput, PublishedPlanUncheckedCreateWithoutReviewsInput>
    where?: PublishedPlanWhereInput
  }

  export type PublishedPlanUpdateToOneWithWhereWithoutReviewsInput = {
    where?: PublishedPlanWhereInput
    data: XOR<PublishedPlanUpdateWithoutReviewsInput, PublishedPlanUncheckedUpdateWithoutReviewsInput>
  }

  export type PublishedPlanUpdateWithoutReviewsInput = {
    id?: StringFieldUpdateOperationsInput | string
    publisherId?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    goal?: StringFieldUpdateOperationsInput | string
    moderationStatus?: EnumPublishModerationStatusFieldUpdateOperationsInput | $Enums.PublishModerationStatus
    moderationNote?: NullableStringFieldUpdateOperationsInput | string | null
    avgRating?: FloatFieldUpdateOperationsInput | number
    ratingCount?: IntFieldUpdateOperationsInput | number
    publishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    sourcePlan?: WorkoutPlanUpdateOneRequiredWithoutPublishedListingsNestedInput
    packages?: TrainingPackageUpdateManyWithoutPublishedPlanNestedInput
  }

  export type PublishedPlanUncheckedUpdateWithoutReviewsInput = {
    id?: StringFieldUpdateOperationsInput | string
    sourcePlanId?: StringFieldUpdateOperationsInput | string
    publisherId?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    goal?: StringFieldUpdateOperationsInput | string
    moderationStatus?: EnumPublishModerationStatusFieldUpdateOperationsInput | $Enums.PublishModerationStatus
    moderationNote?: NullableStringFieldUpdateOperationsInput | string | null
    avgRating?: FloatFieldUpdateOperationsInput | number
    ratingCount?: IntFieldUpdateOperationsInput | number
    publishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    packages?: TrainingPackageUncheckedUpdateManyWithoutPublishedPlanNestedInput
  }

  export type PublishedPlanCreateWithoutPackagesInput = {
    id?: string
    publisherId: string
    title: string
    description?: string | null
    goal: string
    moderationStatus?: $Enums.PublishModerationStatus
    moderationNote?: string | null
    avgRating?: number
    ratingCount?: number
    publishedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    sourcePlan: WorkoutPlanCreateNestedOneWithoutPublishedListingsInput
    reviews?: PlanReviewCreateNestedManyWithoutPublishedPlanInput
  }

  export type PublishedPlanUncheckedCreateWithoutPackagesInput = {
    id?: string
    sourcePlanId: string
    publisherId: string
    title: string
    description?: string | null
    goal: string
    moderationStatus?: $Enums.PublishModerationStatus
    moderationNote?: string | null
    avgRating?: number
    ratingCount?: number
    publishedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    reviews?: PlanReviewUncheckedCreateNestedManyWithoutPublishedPlanInput
  }

  export type PublishedPlanCreateOrConnectWithoutPackagesInput = {
    where: PublishedPlanWhereUniqueInput
    create: XOR<PublishedPlanCreateWithoutPackagesInput, PublishedPlanUncheckedCreateWithoutPackagesInput>
  }

  export type TrainingPackagePurchaseCreateWithoutPackageInput = {
    id?: string
    buyerId: string
    priceAtPurchase: number
    paymentTransactionId?: string | null
    status?: $Enums.TrainingPackagePurchaseStatus
    purchasedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type TrainingPackagePurchaseUncheckedCreateWithoutPackageInput = {
    id?: string
    buyerId: string
    priceAtPurchase: number
    paymentTransactionId?: string | null
    status?: $Enums.TrainingPackagePurchaseStatus
    purchasedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type TrainingPackagePurchaseCreateOrConnectWithoutPackageInput = {
    where: TrainingPackagePurchaseWhereUniqueInput
    create: XOR<TrainingPackagePurchaseCreateWithoutPackageInput, TrainingPackagePurchaseUncheckedCreateWithoutPackageInput>
  }

  export type TrainingPackagePurchaseCreateManyPackageInputEnvelope = {
    data: TrainingPackagePurchaseCreateManyPackageInput | TrainingPackagePurchaseCreateManyPackageInput[]
    skipDuplicates?: boolean
  }

  export type PublishedPlanUpsertWithoutPackagesInput = {
    update: XOR<PublishedPlanUpdateWithoutPackagesInput, PublishedPlanUncheckedUpdateWithoutPackagesInput>
    create: XOR<PublishedPlanCreateWithoutPackagesInput, PublishedPlanUncheckedCreateWithoutPackagesInput>
    where?: PublishedPlanWhereInput
  }

  export type PublishedPlanUpdateToOneWithWhereWithoutPackagesInput = {
    where?: PublishedPlanWhereInput
    data: XOR<PublishedPlanUpdateWithoutPackagesInput, PublishedPlanUncheckedUpdateWithoutPackagesInput>
  }

  export type PublishedPlanUpdateWithoutPackagesInput = {
    id?: StringFieldUpdateOperationsInput | string
    publisherId?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    goal?: StringFieldUpdateOperationsInput | string
    moderationStatus?: EnumPublishModerationStatusFieldUpdateOperationsInput | $Enums.PublishModerationStatus
    moderationNote?: NullableStringFieldUpdateOperationsInput | string | null
    avgRating?: FloatFieldUpdateOperationsInput | number
    ratingCount?: IntFieldUpdateOperationsInput | number
    publishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    sourcePlan?: WorkoutPlanUpdateOneRequiredWithoutPublishedListingsNestedInput
    reviews?: PlanReviewUpdateManyWithoutPublishedPlanNestedInput
  }

  export type PublishedPlanUncheckedUpdateWithoutPackagesInput = {
    id?: StringFieldUpdateOperationsInput | string
    sourcePlanId?: StringFieldUpdateOperationsInput | string
    publisherId?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    goal?: StringFieldUpdateOperationsInput | string
    moderationStatus?: EnumPublishModerationStatusFieldUpdateOperationsInput | $Enums.PublishModerationStatus
    moderationNote?: NullableStringFieldUpdateOperationsInput | string | null
    avgRating?: FloatFieldUpdateOperationsInput | number
    ratingCount?: IntFieldUpdateOperationsInput | number
    publishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    reviews?: PlanReviewUncheckedUpdateManyWithoutPublishedPlanNestedInput
  }

  export type TrainingPackagePurchaseUpsertWithWhereUniqueWithoutPackageInput = {
    where: TrainingPackagePurchaseWhereUniqueInput
    update: XOR<TrainingPackagePurchaseUpdateWithoutPackageInput, TrainingPackagePurchaseUncheckedUpdateWithoutPackageInput>
    create: XOR<TrainingPackagePurchaseCreateWithoutPackageInput, TrainingPackagePurchaseUncheckedCreateWithoutPackageInput>
  }

  export type TrainingPackagePurchaseUpdateWithWhereUniqueWithoutPackageInput = {
    where: TrainingPackagePurchaseWhereUniqueInput
    data: XOR<TrainingPackagePurchaseUpdateWithoutPackageInput, TrainingPackagePurchaseUncheckedUpdateWithoutPackageInput>
  }

  export type TrainingPackagePurchaseUpdateManyWithWhereWithoutPackageInput = {
    where: TrainingPackagePurchaseScalarWhereInput
    data: XOR<TrainingPackagePurchaseUpdateManyMutationInput, TrainingPackagePurchaseUncheckedUpdateManyWithoutPackageInput>
  }

  export type TrainingPackagePurchaseScalarWhereInput = {
    AND?: TrainingPackagePurchaseScalarWhereInput | TrainingPackagePurchaseScalarWhereInput[]
    OR?: TrainingPackagePurchaseScalarWhereInput[]
    NOT?: TrainingPackagePurchaseScalarWhereInput | TrainingPackagePurchaseScalarWhereInput[]
    id?: StringFilter<"TrainingPackagePurchase"> | string
    packageId?: StringFilter<"TrainingPackagePurchase"> | string
    buyerId?: StringFilter<"TrainingPackagePurchase"> | string
    priceAtPurchase?: FloatFilter<"TrainingPackagePurchase"> | number
    paymentTransactionId?: StringNullableFilter<"TrainingPackagePurchase"> | string | null
    status?: EnumTrainingPackagePurchaseStatusFilter<"TrainingPackagePurchase"> | $Enums.TrainingPackagePurchaseStatus
    purchasedAt?: DateTimeNullableFilter<"TrainingPackagePurchase"> | Date | string | null
    createdAt?: DateTimeFilter<"TrainingPackagePurchase"> | Date | string
    updatedAt?: DateTimeFilter<"TrainingPackagePurchase"> | Date | string
  }

  export type TrainingPackageCreateWithoutPurchasesInput = {
    id?: string
    sellerId: string
    name: string
    description?: string | null
    price: number
    durationWeeks?: number | null
    status?: $Enums.TrainingPackageStatus
    createdAt?: Date | string
    updatedAt?: Date | string
    publishedPlan: PublishedPlanCreateNestedOneWithoutPackagesInput
  }

  export type TrainingPackageUncheckedCreateWithoutPurchasesInput = {
    id?: string
    sellerId: string
    publishedPlanId: string
    name: string
    description?: string | null
    price: number
    durationWeeks?: number | null
    status?: $Enums.TrainingPackageStatus
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type TrainingPackageCreateOrConnectWithoutPurchasesInput = {
    where: TrainingPackageWhereUniqueInput
    create: XOR<TrainingPackageCreateWithoutPurchasesInput, TrainingPackageUncheckedCreateWithoutPurchasesInput>
  }

  export type TrainingPackageUpsertWithoutPurchasesInput = {
    update: XOR<TrainingPackageUpdateWithoutPurchasesInput, TrainingPackageUncheckedUpdateWithoutPurchasesInput>
    create: XOR<TrainingPackageCreateWithoutPurchasesInput, TrainingPackageUncheckedCreateWithoutPurchasesInput>
    where?: TrainingPackageWhereInput
  }

  export type TrainingPackageUpdateToOneWithWhereWithoutPurchasesInput = {
    where?: TrainingPackageWhereInput
    data: XOR<TrainingPackageUpdateWithoutPurchasesInput, TrainingPackageUncheckedUpdateWithoutPurchasesInput>
  }

  export type TrainingPackageUpdateWithoutPurchasesInput = {
    id?: StringFieldUpdateOperationsInput | string
    sellerId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    price?: FloatFieldUpdateOperationsInput | number
    durationWeeks?: NullableIntFieldUpdateOperationsInput | number | null
    status?: EnumTrainingPackageStatusFieldUpdateOperationsInput | $Enums.TrainingPackageStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    publishedPlan?: PublishedPlanUpdateOneRequiredWithoutPackagesNestedInput
  }

  export type TrainingPackageUncheckedUpdateWithoutPurchasesInput = {
    id?: StringFieldUpdateOperationsInput | string
    sellerId?: StringFieldUpdateOperationsInput | string
    publishedPlanId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    price?: FloatFieldUpdateOperationsInput | number
    durationWeeks?: NullableIntFieldUpdateOperationsInput | number | null
    status?: EnumTrainingPackageStatusFieldUpdateOperationsInput | $Enums.TrainingPackageStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type KnowledgeDocumentCreateWithoutSourceInput = {
    id?: string
    url: string
    title?: string | null
    author?: string | null
    language?: string | null
    contentHash: string
    rawObjectKey?: string | null
    cleanText?: string | null
    topic?: $Enums.KnowledgeDocumentTopic | null
    trustScore?: Decimal | DecimalJsLike | number | string | null
    qualityScore?: Decimal | DecimalJsLike | number | string | null
    safetyFlag?: boolean
    status?: $Enums.KnowledgeDocumentStatus
    rejectionReason?: string | null
    publishedAt?: Date | string | null
    crawledAt?: Date | string
    processedAt?: Date | string | null
    chunks?: KnowledgeChunkCreateNestedManyWithoutDocumentInput
    reviewItems?: KnowledgeReviewItemCreateNestedManyWithoutDocumentInput
  }

  export type KnowledgeDocumentUncheckedCreateWithoutSourceInput = {
    id?: string
    url: string
    title?: string | null
    author?: string | null
    language?: string | null
    contentHash: string
    rawObjectKey?: string | null
    cleanText?: string | null
    topic?: $Enums.KnowledgeDocumentTopic | null
    trustScore?: Decimal | DecimalJsLike | number | string | null
    qualityScore?: Decimal | DecimalJsLike | number | string | null
    safetyFlag?: boolean
    status?: $Enums.KnowledgeDocumentStatus
    rejectionReason?: string | null
    publishedAt?: Date | string | null
    crawledAt?: Date | string
    processedAt?: Date | string | null
    chunks?: KnowledgeChunkUncheckedCreateNestedManyWithoutDocumentInput
    reviewItems?: KnowledgeReviewItemUncheckedCreateNestedManyWithoutDocumentInput
  }

  export type KnowledgeDocumentCreateOrConnectWithoutSourceInput = {
    where: KnowledgeDocumentWhereUniqueInput
    create: XOR<KnowledgeDocumentCreateWithoutSourceInput, KnowledgeDocumentUncheckedCreateWithoutSourceInput>
  }

  export type KnowledgeDocumentCreateManySourceInputEnvelope = {
    data: KnowledgeDocumentCreateManySourceInput | KnowledgeDocumentCreateManySourceInput[]
    skipDuplicates?: boolean
  }

  export type KnowledgeDocumentUpsertWithWhereUniqueWithoutSourceInput = {
    where: KnowledgeDocumentWhereUniqueInput
    update: XOR<KnowledgeDocumentUpdateWithoutSourceInput, KnowledgeDocumentUncheckedUpdateWithoutSourceInput>
    create: XOR<KnowledgeDocumentCreateWithoutSourceInput, KnowledgeDocumentUncheckedCreateWithoutSourceInput>
  }

  export type KnowledgeDocumentUpdateWithWhereUniqueWithoutSourceInput = {
    where: KnowledgeDocumentWhereUniqueInput
    data: XOR<KnowledgeDocumentUpdateWithoutSourceInput, KnowledgeDocumentUncheckedUpdateWithoutSourceInput>
  }

  export type KnowledgeDocumentUpdateManyWithWhereWithoutSourceInput = {
    where: KnowledgeDocumentScalarWhereInput
    data: XOR<KnowledgeDocumentUpdateManyMutationInput, KnowledgeDocumentUncheckedUpdateManyWithoutSourceInput>
  }

  export type KnowledgeDocumentScalarWhereInput = {
    AND?: KnowledgeDocumentScalarWhereInput | KnowledgeDocumentScalarWhereInput[]
    OR?: KnowledgeDocumentScalarWhereInput[]
    NOT?: KnowledgeDocumentScalarWhereInput | KnowledgeDocumentScalarWhereInput[]
    id?: StringFilter<"KnowledgeDocument"> | string
    sourceId?: StringFilter<"KnowledgeDocument"> | string
    url?: StringFilter<"KnowledgeDocument"> | string
    title?: StringNullableFilter<"KnowledgeDocument"> | string | null
    author?: StringNullableFilter<"KnowledgeDocument"> | string | null
    language?: StringNullableFilter<"KnowledgeDocument"> | string | null
    contentHash?: StringFilter<"KnowledgeDocument"> | string
    rawObjectKey?: StringNullableFilter<"KnowledgeDocument"> | string | null
    cleanText?: StringNullableFilter<"KnowledgeDocument"> | string | null
    topic?: EnumKnowledgeDocumentTopicNullableFilter<"KnowledgeDocument"> | $Enums.KnowledgeDocumentTopic | null
    trustScore?: DecimalNullableFilter<"KnowledgeDocument"> | Decimal | DecimalJsLike | number | string | null
    qualityScore?: DecimalNullableFilter<"KnowledgeDocument"> | Decimal | DecimalJsLike | number | string | null
    safetyFlag?: BoolFilter<"KnowledgeDocument"> | boolean
    status?: EnumKnowledgeDocumentStatusFilter<"KnowledgeDocument"> | $Enums.KnowledgeDocumentStatus
    rejectionReason?: StringNullableFilter<"KnowledgeDocument"> | string | null
    publishedAt?: DateTimeNullableFilter<"KnowledgeDocument"> | Date | string | null
    crawledAt?: DateTimeFilter<"KnowledgeDocument"> | Date | string
    processedAt?: DateTimeNullableFilter<"KnowledgeDocument"> | Date | string | null
  }

  export type KnowledgeSourceCreateWithoutDocumentsInput = {
    id?: string
    name: string
    baseUrl: string
    sourceType: $Enums.KnowledgeSourceType
    trustTier?: number
    crawlCron?: string
    isActive?: boolean
    lastCrawledAt?: Date | string | null
    createdAt?: Date | string
  }

  export type KnowledgeSourceUncheckedCreateWithoutDocumentsInput = {
    id?: string
    name: string
    baseUrl: string
    sourceType: $Enums.KnowledgeSourceType
    trustTier?: number
    crawlCron?: string
    isActive?: boolean
    lastCrawledAt?: Date | string | null
    createdAt?: Date | string
  }

  export type KnowledgeSourceCreateOrConnectWithoutDocumentsInput = {
    where: KnowledgeSourceWhereUniqueInput
    create: XOR<KnowledgeSourceCreateWithoutDocumentsInput, KnowledgeSourceUncheckedCreateWithoutDocumentsInput>
  }

  export type KnowledgeChunkCreateWithoutDocumentInput = {
    id?: string
    chunkIndex: number
    text: string
    tokenCount?: number | null
    vectorId: string
    embeddedAt?: Date | string
  }

  export type KnowledgeChunkUncheckedCreateWithoutDocumentInput = {
    id?: string
    chunkIndex: number
    text: string
    tokenCount?: number | null
    vectorId: string
    embeddedAt?: Date | string
  }

  export type KnowledgeChunkCreateOrConnectWithoutDocumentInput = {
    where: KnowledgeChunkWhereUniqueInput
    create: XOR<KnowledgeChunkCreateWithoutDocumentInput, KnowledgeChunkUncheckedCreateWithoutDocumentInput>
  }

  export type KnowledgeChunkCreateManyDocumentInputEnvelope = {
    data: KnowledgeChunkCreateManyDocumentInput | KnowledgeChunkCreateManyDocumentInput[]
    skipDuplicates?: boolean
  }

  export type KnowledgeReviewItemCreateWithoutDocumentInput = {
    id?: string
    reason?: string | null
    status?: $Enums.KnowledgeReviewStatus
    reviewedBy?: string | null
    reviewedAt?: Date | string | null
  }

  export type KnowledgeReviewItemUncheckedCreateWithoutDocumentInput = {
    id?: string
    reason?: string | null
    status?: $Enums.KnowledgeReviewStatus
    reviewedBy?: string | null
    reviewedAt?: Date | string | null
  }

  export type KnowledgeReviewItemCreateOrConnectWithoutDocumentInput = {
    where: KnowledgeReviewItemWhereUniqueInput
    create: XOR<KnowledgeReviewItemCreateWithoutDocumentInput, KnowledgeReviewItemUncheckedCreateWithoutDocumentInput>
  }

  export type KnowledgeReviewItemCreateManyDocumentInputEnvelope = {
    data: KnowledgeReviewItemCreateManyDocumentInput | KnowledgeReviewItemCreateManyDocumentInput[]
    skipDuplicates?: boolean
  }

  export type KnowledgeSourceUpsertWithoutDocumentsInput = {
    update: XOR<KnowledgeSourceUpdateWithoutDocumentsInput, KnowledgeSourceUncheckedUpdateWithoutDocumentsInput>
    create: XOR<KnowledgeSourceCreateWithoutDocumentsInput, KnowledgeSourceUncheckedCreateWithoutDocumentsInput>
    where?: KnowledgeSourceWhereInput
  }

  export type KnowledgeSourceUpdateToOneWithWhereWithoutDocumentsInput = {
    where?: KnowledgeSourceWhereInput
    data: XOR<KnowledgeSourceUpdateWithoutDocumentsInput, KnowledgeSourceUncheckedUpdateWithoutDocumentsInput>
  }

  export type KnowledgeSourceUpdateWithoutDocumentsInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    baseUrl?: StringFieldUpdateOperationsInput | string
    sourceType?: EnumKnowledgeSourceTypeFieldUpdateOperationsInput | $Enums.KnowledgeSourceType
    trustTier?: IntFieldUpdateOperationsInput | number
    crawlCron?: StringFieldUpdateOperationsInput | string
    isActive?: BoolFieldUpdateOperationsInput | boolean
    lastCrawledAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type KnowledgeSourceUncheckedUpdateWithoutDocumentsInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    baseUrl?: StringFieldUpdateOperationsInput | string
    sourceType?: EnumKnowledgeSourceTypeFieldUpdateOperationsInput | $Enums.KnowledgeSourceType
    trustTier?: IntFieldUpdateOperationsInput | number
    crawlCron?: StringFieldUpdateOperationsInput | string
    isActive?: BoolFieldUpdateOperationsInput | boolean
    lastCrawledAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type KnowledgeChunkUpsertWithWhereUniqueWithoutDocumentInput = {
    where: KnowledgeChunkWhereUniqueInput
    update: XOR<KnowledgeChunkUpdateWithoutDocumentInput, KnowledgeChunkUncheckedUpdateWithoutDocumentInput>
    create: XOR<KnowledgeChunkCreateWithoutDocumentInput, KnowledgeChunkUncheckedCreateWithoutDocumentInput>
  }

  export type KnowledgeChunkUpdateWithWhereUniqueWithoutDocumentInput = {
    where: KnowledgeChunkWhereUniqueInput
    data: XOR<KnowledgeChunkUpdateWithoutDocumentInput, KnowledgeChunkUncheckedUpdateWithoutDocumentInput>
  }

  export type KnowledgeChunkUpdateManyWithWhereWithoutDocumentInput = {
    where: KnowledgeChunkScalarWhereInput
    data: XOR<KnowledgeChunkUpdateManyMutationInput, KnowledgeChunkUncheckedUpdateManyWithoutDocumentInput>
  }

  export type KnowledgeChunkScalarWhereInput = {
    AND?: KnowledgeChunkScalarWhereInput | KnowledgeChunkScalarWhereInput[]
    OR?: KnowledgeChunkScalarWhereInput[]
    NOT?: KnowledgeChunkScalarWhereInput | KnowledgeChunkScalarWhereInput[]
    id?: StringFilter<"KnowledgeChunk"> | string
    documentId?: StringFilter<"KnowledgeChunk"> | string
    chunkIndex?: IntFilter<"KnowledgeChunk"> | number
    text?: StringFilter<"KnowledgeChunk"> | string
    tokenCount?: IntNullableFilter<"KnowledgeChunk"> | number | null
    vectorId?: StringFilter<"KnowledgeChunk"> | string
    embeddedAt?: DateTimeFilter<"KnowledgeChunk"> | Date | string
  }

  export type KnowledgeReviewItemUpsertWithWhereUniqueWithoutDocumentInput = {
    where: KnowledgeReviewItemWhereUniqueInput
    update: XOR<KnowledgeReviewItemUpdateWithoutDocumentInput, KnowledgeReviewItemUncheckedUpdateWithoutDocumentInput>
    create: XOR<KnowledgeReviewItemCreateWithoutDocumentInput, KnowledgeReviewItemUncheckedCreateWithoutDocumentInput>
  }

  export type KnowledgeReviewItemUpdateWithWhereUniqueWithoutDocumentInput = {
    where: KnowledgeReviewItemWhereUniqueInput
    data: XOR<KnowledgeReviewItemUpdateWithoutDocumentInput, KnowledgeReviewItemUncheckedUpdateWithoutDocumentInput>
  }

  export type KnowledgeReviewItemUpdateManyWithWhereWithoutDocumentInput = {
    where: KnowledgeReviewItemScalarWhereInput
    data: XOR<KnowledgeReviewItemUpdateManyMutationInput, KnowledgeReviewItemUncheckedUpdateManyWithoutDocumentInput>
  }

  export type KnowledgeReviewItemScalarWhereInput = {
    AND?: KnowledgeReviewItemScalarWhereInput | KnowledgeReviewItemScalarWhereInput[]
    OR?: KnowledgeReviewItemScalarWhereInput[]
    NOT?: KnowledgeReviewItemScalarWhereInput | KnowledgeReviewItemScalarWhereInput[]
    id?: StringFilter<"KnowledgeReviewItem"> | string
    documentId?: StringFilter<"KnowledgeReviewItem"> | string
    reason?: StringNullableFilter<"KnowledgeReviewItem"> | string | null
    status?: EnumKnowledgeReviewStatusFilter<"KnowledgeReviewItem"> | $Enums.KnowledgeReviewStatus
    reviewedBy?: StringNullableFilter<"KnowledgeReviewItem"> | string | null
    reviewedAt?: DateTimeNullableFilter<"KnowledgeReviewItem"> | Date | string | null
  }

  export type KnowledgeDocumentCreateWithoutChunksInput = {
    id?: string
    url: string
    title?: string | null
    author?: string | null
    language?: string | null
    contentHash: string
    rawObjectKey?: string | null
    cleanText?: string | null
    topic?: $Enums.KnowledgeDocumentTopic | null
    trustScore?: Decimal | DecimalJsLike | number | string | null
    qualityScore?: Decimal | DecimalJsLike | number | string | null
    safetyFlag?: boolean
    status?: $Enums.KnowledgeDocumentStatus
    rejectionReason?: string | null
    publishedAt?: Date | string | null
    crawledAt?: Date | string
    processedAt?: Date | string | null
    source: KnowledgeSourceCreateNestedOneWithoutDocumentsInput
    reviewItems?: KnowledgeReviewItemCreateNestedManyWithoutDocumentInput
  }

  export type KnowledgeDocumentUncheckedCreateWithoutChunksInput = {
    id?: string
    sourceId: string
    url: string
    title?: string | null
    author?: string | null
    language?: string | null
    contentHash: string
    rawObjectKey?: string | null
    cleanText?: string | null
    topic?: $Enums.KnowledgeDocumentTopic | null
    trustScore?: Decimal | DecimalJsLike | number | string | null
    qualityScore?: Decimal | DecimalJsLike | number | string | null
    safetyFlag?: boolean
    status?: $Enums.KnowledgeDocumentStatus
    rejectionReason?: string | null
    publishedAt?: Date | string | null
    crawledAt?: Date | string
    processedAt?: Date | string | null
    reviewItems?: KnowledgeReviewItemUncheckedCreateNestedManyWithoutDocumentInput
  }

  export type KnowledgeDocumentCreateOrConnectWithoutChunksInput = {
    where: KnowledgeDocumentWhereUniqueInput
    create: XOR<KnowledgeDocumentCreateWithoutChunksInput, KnowledgeDocumentUncheckedCreateWithoutChunksInput>
  }

  export type KnowledgeDocumentUpsertWithoutChunksInput = {
    update: XOR<KnowledgeDocumentUpdateWithoutChunksInput, KnowledgeDocumentUncheckedUpdateWithoutChunksInput>
    create: XOR<KnowledgeDocumentCreateWithoutChunksInput, KnowledgeDocumentUncheckedCreateWithoutChunksInput>
    where?: KnowledgeDocumentWhereInput
  }

  export type KnowledgeDocumentUpdateToOneWithWhereWithoutChunksInput = {
    where?: KnowledgeDocumentWhereInput
    data: XOR<KnowledgeDocumentUpdateWithoutChunksInput, KnowledgeDocumentUncheckedUpdateWithoutChunksInput>
  }

  export type KnowledgeDocumentUpdateWithoutChunksInput = {
    id?: StringFieldUpdateOperationsInput | string
    url?: StringFieldUpdateOperationsInput | string
    title?: NullableStringFieldUpdateOperationsInput | string | null
    author?: NullableStringFieldUpdateOperationsInput | string | null
    language?: NullableStringFieldUpdateOperationsInput | string | null
    contentHash?: StringFieldUpdateOperationsInput | string
    rawObjectKey?: NullableStringFieldUpdateOperationsInput | string | null
    cleanText?: NullableStringFieldUpdateOperationsInput | string | null
    topic?: NullableEnumKnowledgeDocumentTopicFieldUpdateOperationsInput | $Enums.KnowledgeDocumentTopic | null
    trustScore?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    qualityScore?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    safetyFlag?: BoolFieldUpdateOperationsInput | boolean
    status?: EnumKnowledgeDocumentStatusFieldUpdateOperationsInput | $Enums.KnowledgeDocumentStatus
    rejectionReason?: NullableStringFieldUpdateOperationsInput | string | null
    publishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    crawledAt?: DateTimeFieldUpdateOperationsInput | Date | string
    processedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    source?: KnowledgeSourceUpdateOneRequiredWithoutDocumentsNestedInput
    reviewItems?: KnowledgeReviewItemUpdateManyWithoutDocumentNestedInput
  }

  export type KnowledgeDocumentUncheckedUpdateWithoutChunksInput = {
    id?: StringFieldUpdateOperationsInput | string
    sourceId?: StringFieldUpdateOperationsInput | string
    url?: StringFieldUpdateOperationsInput | string
    title?: NullableStringFieldUpdateOperationsInput | string | null
    author?: NullableStringFieldUpdateOperationsInput | string | null
    language?: NullableStringFieldUpdateOperationsInput | string | null
    contentHash?: StringFieldUpdateOperationsInput | string
    rawObjectKey?: NullableStringFieldUpdateOperationsInput | string | null
    cleanText?: NullableStringFieldUpdateOperationsInput | string | null
    topic?: NullableEnumKnowledgeDocumentTopicFieldUpdateOperationsInput | $Enums.KnowledgeDocumentTopic | null
    trustScore?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    qualityScore?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    safetyFlag?: BoolFieldUpdateOperationsInput | boolean
    status?: EnumKnowledgeDocumentStatusFieldUpdateOperationsInput | $Enums.KnowledgeDocumentStatus
    rejectionReason?: NullableStringFieldUpdateOperationsInput | string | null
    publishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    crawledAt?: DateTimeFieldUpdateOperationsInput | Date | string
    processedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    reviewItems?: KnowledgeReviewItemUncheckedUpdateManyWithoutDocumentNestedInput
  }

  export type KnowledgeDocumentCreateWithoutReviewItemsInput = {
    id?: string
    url: string
    title?: string | null
    author?: string | null
    language?: string | null
    contentHash: string
    rawObjectKey?: string | null
    cleanText?: string | null
    topic?: $Enums.KnowledgeDocumentTopic | null
    trustScore?: Decimal | DecimalJsLike | number | string | null
    qualityScore?: Decimal | DecimalJsLike | number | string | null
    safetyFlag?: boolean
    status?: $Enums.KnowledgeDocumentStatus
    rejectionReason?: string | null
    publishedAt?: Date | string | null
    crawledAt?: Date | string
    processedAt?: Date | string | null
    source: KnowledgeSourceCreateNestedOneWithoutDocumentsInput
    chunks?: KnowledgeChunkCreateNestedManyWithoutDocumentInput
  }

  export type KnowledgeDocumentUncheckedCreateWithoutReviewItemsInput = {
    id?: string
    sourceId: string
    url: string
    title?: string | null
    author?: string | null
    language?: string | null
    contentHash: string
    rawObjectKey?: string | null
    cleanText?: string | null
    topic?: $Enums.KnowledgeDocumentTopic | null
    trustScore?: Decimal | DecimalJsLike | number | string | null
    qualityScore?: Decimal | DecimalJsLike | number | string | null
    safetyFlag?: boolean
    status?: $Enums.KnowledgeDocumentStatus
    rejectionReason?: string | null
    publishedAt?: Date | string | null
    crawledAt?: Date | string
    processedAt?: Date | string | null
    chunks?: KnowledgeChunkUncheckedCreateNestedManyWithoutDocumentInput
  }

  export type KnowledgeDocumentCreateOrConnectWithoutReviewItemsInput = {
    where: KnowledgeDocumentWhereUniqueInput
    create: XOR<KnowledgeDocumentCreateWithoutReviewItemsInput, KnowledgeDocumentUncheckedCreateWithoutReviewItemsInput>
  }

  export type KnowledgeDocumentUpsertWithoutReviewItemsInput = {
    update: XOR<KnowledgeDocumentUpdateWithoutReviewItemsInput, KnowledgeDocumentUncheckedUpdateWithoutReviewItemsInput>
    create: XOR<KnowledgeDocumentCreateWithoutReviewItemsInput, KnowledgeDocumentUncheckedCreateWithoutReviewItemsInput>
    where?: KnowledgeDocumentWhereInput
  }

  export type KnowledgeDocumentUpdateToOneWithWhereWithoutReviewItemsInput = {
    where?: KnowledgeDocumentWhereInput
    data: XOR<KnowledgeDocumentUpdateWithoutReviewItemsInput, KnowledgeDocumentUncheckedUpdateWithoutReviewItemsInput>
  }

  export type KnowledgeDocumentUpdateWithoutReviewItemsInput = {
    id?: StringFieldUpdateOperationsInput | string
    url?: StringFieldUpdateOperationsInput | string
    title?: NullableStringFieldUpdateOperationsInput | string | null
    author?: NullableStringFieldUpdateOperationsInput | string | null
    language?: NullableStringFieldUpdateOperationsInput | string | null
    contentHash?: StringFieldUpdateOperationsInput | string
    rawObjectKey?: NullableStringFieldUpdateOperationsInput | string | null
    cleanText?: NullableStringFieldUpdateOperationsInput | string | null
    topic?: NullableEnumKnowledgeDocumentTopicFieldUpdateOperationsInput | $Enums.KnowledgeDocumentTopic | null
    trustScore?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    qualityScore?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    safetyFlag?: BoolFieldUpdateOperationsInput | boolean
    status?: EnumKnowledgeDocumentStatusFieldUpdateOperationsInput | $Enums.KnowledgeDocumentStatus
    rejectionReason?: NullableStringFieldUpdateOperationsInput | string | null
    publishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    crawledAt?: DateTimeFieldUpdateOperationsInput | Date | string
    processedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    source?: KnowledgeSourceUpdateOneRequiredWithoutDocumentsNestedInput
    chunks?: KnowledgeChunkUpdateManyWithoutDocumentNestedInput
  }

  export type KnowledgeDocumentUncheckedUpdateWithoutReviewItemsInput = {
    id?: StringFieldUpdateOperationsInput | string
    sourceId?: StringFieldUpdateOperationsInput | string
    url?: StringFieldUpdateOperationsInput | string
    title?: NullableStringFieldUpdateOperationsInput | string | null
    author?: NullableStringFieldUpdateOperationsInput | string | null
    language?: NullableStringFieldUpdateOperationsInput | string | null
    contentHash?: StringFieldUpdateOperationsInput | string
    rawObjectKey?: NullableStringFieldUpdateOperationsInput | string | null
    cleanText?: NullableStringFieldUpdateOperationsInput | string | null
    topic?: NullableEnumKnowledgeDocumentTopicFieldUpdateOperationsInput | $Enums.KnowledgeDocumentTopic | null
    trustScore?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    qualityScore?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    safetyFlag?: BoolFieldUpdateOperationsInput | boolean
    status?: EnumKnowledgeDocumentStatusFieldUpdateOperationsInput | $Enums.KnowledgeDocumentStatus
    rejectionReason?: NullableStringFieldUpdateOperationsInput | string | null
    publishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    crawledAt?: DateTimeFieldUpdateOperationsInput | Date | string
    processedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    chunks?: KnowledgeChunkUncheckedUpdateManyWithoutDocumentNestedInput
  }

  export type PublishedPlanCreateManySourcePlanInput = {
    id?: string
    publisherId: string
    title: string
    description?: string | null
    goal: string
    moderationStatus?: $Enums.PublishModerationStatus
    moderationNote?: string | null
    avgRating?: number
    ratingCount?: number
    publishedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type PublishedPlanUpdateWithoutSourcePlanInput = {
    id?: StringFieldUpdateOperationsInput | string
    publisherId?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    goal?: StringFieldUpdateOperationsInput | string
    moderationStatus?: EnumPublishModerationStatusFieldUpdateOperationsInput | $Enums.PublishModerationStatus
    moderationNote?: NullableStringFieldUpdateOperationsInput | string | null
    avgRating?: FloatFieldUpdateOperationsInput | number
    ratingCount?: IntFieldUpdateOperationsInput | number
    publishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    reviews?: PlanReviewUpdateManyWithoutPublishedPlanNestedInput
    packages?: TrainingPackageUpdateManyWithoutPublishedPlanNestedInput
  }

  export type PublishedPlanUncheckedUpdateWithoutSourcePlanInput = {
    id?: StringFieldUpdateOperationsInput | string
    publisherId?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    goal?: StringFieldUpdateOperationsInput | string
    moderationStatus?: EnumPublishModerationStatusFieldUpdateOperationsInput | $Enums.PublishModerationStatus
    moderationNote?: NullableStringFieldUpdateOperationsInput | string | null
    avgRating?: FloatFieldUpdateOperationsInput | number
    ratingCount?: IntFieldUpdateOperationsInput | number
    publishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    reviews?: PlanReviewUncheckedUpdateManyWithoutPublishedPlanNestedInput
    packages?: TrainingPackageUncheckedUpdateManyWithoutPublishedPlanNestedInput
  }

  export type PublishedPlanUncheckedUpdateManyWithoutSourcePlanInput = {
    id?: StringFieldUpdateOperationsInput | string
    publisherId?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    goal?: StringFieldUpdateOperationsInput | string
    moderationStatus?: EnumPublishModerationStatusFieldUpdateOperationsInput | $Enums.PublishModerationStatus
    moderationNote?: NullableStringFieldUpdateOperationsInput | string | null
    avgRating?: FloatFieldUpdateOperationsInput | number
    ratingCount?: IntFieldUpdateOperationsInput | number
    publishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PlanReviewCreateManyPublishedPlanInput = {
    id?: string
    reviewerId: string
    rating: number
    comment?: string | null
    createdAt?: Date | string
  }

  export type TrainingPackageCreateManyPublishedPlanInput = {
    id?: string
    sellerId: string
    name: string
    description?: string | null
    price: number
    durationWeeks?: number | null
    status?: $Enums.TrainingPackageStatus
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type PlanReviewUpdateWithoutPublishedPlanInput = {
    id?: StringFieldUpdateOperationsInput | string
    reviewerId?: StringFieldUpdateOperationsInput | string
    rating?: IntFieldUpdateOperationsInput | number
    comment?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PlanReviewUncheckedUpdateWithoutPublishedPlanInput = {
    id?: StringFieldUpdateOperationsInput | string
    reviewerId?: StringFieldUpdateOperationsInput | string
    rating?: IntFieldUpdateOperationsInput | number
    comment?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PlanReviewUncheckedUpdateManyWithoutPublishedPlanInput = {
    id?: StringFieldUpdateOperationsInput | string
    reviewerId?: StringFieldUpdateOperationsInput | string
    rating?: IntFieldUpdateOperationsInput | number
    comment?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TrainingPackageUpdateWithoutPublishedPlanInput = {
    id?: StringFieldUpdateOperationsInput | string
    sellerId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    price?: FloatFieldUpdateOperationsInput | number
    durationWeeks?: NullableIntFieldUpdateOperationsInput | number | null
    status?: EnumTrainingPackageStatusFieldUpdateOperationsInput | $Enums.TrainingPackageStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    purchases?: TrainingPackagePurchaseUpdateManyWithoutPackageNestedInput
  }

  export type TrainingPackageUncheckedUpdateWithoutPublishedPlanInput = {
    id?: StringFieldUpdateOperationsInput | string
    sellerId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    price?: FloatFieldUpdateOperationsInput | number
    durationWeeks?: NullableIntFieldUpdateOperationsInput | number | null
    status?: EnumTrainingPackageStatusFieldUpdateOperationsInput | $Enums.TrainingPackageStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    purchases?: TrainingPackagePurchaseUncheckedUpdateManyWithoutPackageNestedInput
  }

  export type TrainingPackageUncheckedUpdateManyWithoutPublishedPlanInput = {
    id?: StringFieldUpdateOperationsInput | string
    sellerId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    price?: FloatFieldUpdateOperationsInput | number
    durationWeeks?: NullableIntFieldUpdateOperationsInput | number | null
    status?: EnumTrainingPackageStatusFieldUpdateOperationsInput | $Enums.TrainingPackageStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TrainingPackagePurchaseCreateManyPackageInput = {
    id?: string
    buyerId: string
    priceAtPurchase: number
    paymentTransactionId?: string | null
    status?: $Enums.TrainingPackagePurchaseStatus
    purchasedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type TrainingPackagePurchaseUpdateWithoutPackageInput = {
    id?: StringFieldUpdateOperationsInput | string
    buyerId?: StringFieldUpdateOperationsInput | string
    priceAtPurchase?: FloatFieldUpdateOperationsInput | number
    paymentTransactionId?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumTrainingPackagePurchaseStatusFieldUpdateOperationsInput | $Enums.TrainingPackagePurchaseStatus
    purchasedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TrainingPackagePurchaseUncheckedUpdateWithoutPackageInput = {
    id?: StringFieldUpdateOperationsInput | string
    buyerId?: StringFieldUpdateOperationsInput | string
    priceAtPurchase?: FloatFieldUpdateOperationsInput | number
    paymentTransactionId?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumTrainingPackagePurchaseStatusFieldUpdateOperationsInput | $Enums.TrainingPackagePurchaseStatus
    purchasedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TrainingPackagePurchaseUncheckedUpdateManyWithoutPackageInput = {
    id?: StringFieldUpdateOperationsInput | string
    buyerId?: StringFieldUpdateOperationsInput | string
    priceAtPurchase?: FloatFieldUpdateOperationsInput | number
    paymentTransactionId?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumTrainingPackagePurchaseStatusFieldUpdateOperationsInput | $Enums.TrainingPackagePurchaseStatus
    purchasedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type KnowledgeDocumentCreateManySourceInput = {
    id?: string
    url: string
    title?: string | null
    author?: string | null
    language?: string | null
    contentHash: string
    rawObjectKey?: string | null
    cleanText?: string | null
    topic?: $Enums.KnowledgeDocumentTopic | null
    trustScore?: Decimal | DecimalJsLike | number | string | null
    qualityScore?: Decimal | DecimalJsLike | number | string | null
    safetyFlag?: boolean
    status?: $Enums.KnowledgeDocumentStatus
    rejectionReason?: string | null
    publishedAt?: Date | string | null
    crawledAt?: Date | string
    processedAt?: Date | string | null
  }

  export type KnowledgeDocumentUpdateWithoutSourceInput = {
    id?: StringFieldUpdateOperationsInput | string
    url?: StringFieldUpdateOperationsInput | string
    title?: NullableStringFieldUpdateOperationsInput | string | null
    author?: NullableStringFieldUpdateOperationsInput | string | null
    language?: NullableStringFieldUpdateOperationsInput | string | null
    contentHash?: StringFieldUpdateOperationsInput | string
    rawObjectKey?: NullableStringFieldUpdateOperationsInput | string | null
    cleanText?: NullableStringFieldUpdateOperationsInput | string | null
    topic?: NullableEnumKnowledgeDocumentTopicFieldUpdateOperationsInput | $Enums.KnowledgeDocumentTopic | null
    trustScore?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    qualityScore?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    safetyFlag?: BoolFieldUpdateOperationsInput | boolean
    status?: EnumKnowledgeDocumentStatusFieldUpdateOperationsInput | $Enums.KnowledgeDocumentStatus
    rejectionReason?: NullableStringFieldUpdateOperationsInput | string | null
    publishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    crawledAt?: DateTimeFieldUpdateOperationsInput | Date | string
    processedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    chunks?: KnowledgeChunkUpdateManyWithoutDocumentNestedInput
    reviewItems?: KnowledgeReviewItemUpdateManyWithoutDocumentNestedInput
  }

  export type KnowledgeDocumentUncheckedUpdateWithoutSourceInput = {
    id?: StringFieldUpdateOperationsInput | string
    url?: StringFieldUpdateOperationsInput | string
    title?: NullableStringFieldUpdateOperationsInput | string | null
    author?: NullableStringFieldUpdateOperationsInput | string | null
    language?: NullableStringFieldUpdateOperationsInput | string | null
    contentHash?: StringFieldUpdateOperationsInput | string
    rawObjectKey?: NullableStringFieldUpdateOperationsInput | string | null
    cleanText?: NullableStringFieldUpdateOperationsInput | string | null
    topic?: NullableEnumKnowledgeDocumentTopicFieldUpdateOperationsInput | $Enums.KnowledgeDocumentTopic | null
    trustScore?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    qualityScore?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    safetyFlag?: BoolFieldUpdateOperationsInput | boolean
    status?: EnumKnowledgeDocumentStatusFieldUpdateOperationsInput | $Enums.KnowledgeDocumentStatus
    rejectionReason?: NullableStringFieldUpdateOperationsInput | string | null
    publishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    crawledAt?: DateTimeFieldUpdateOperationsInput | Date | string
    processedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    chunks?: KnowledgeChunkUncheckedUpdateManyWithoutDocumentNestedInput
    reviewItems?: KnowledgeReviewItemUncheckedUpdateManyWithoutDocumentNestedInput
  }

  export type KnowledgeDocumentUncheckedUpdateManyWithoutSourceInput = {
    id?: StringFieldUpdateOperationsInput | string
    url?: StringFieldUpdateOperationsInput | string
    title?: NullableStringFieldUpdateOperationsInput | string | null
    author?: NullableStringFieldUpdateOperationsInput | string | null
    language?: NullableStringFieldUpdateOperationsInput | string | null
    contentHash?: StringFieldUpdateOperationsInput | string
    rawObjectKey?: NullableStringFieldUpdateOperationsInput | string | null
    cleanText?: NullableStringFieldUpdateOperationsInput | string | null
    topic?: NullableEnumKnowledgeDocumentTopicFieldUpdateOperationsInput | $Enums.KnowledgeDocumentTopic | null
    trustScore?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    qualityScore?: NullableDecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string | null
    safetyFlag?: BoolFieldUpdateOperationsInput | boolean
    status?: EnumKnowledgeDocumentStatusFieldUpdateOperationsInput | $Enums.KnowledgeDocumentStatus
    rejectionReason?: NullableStringFieldUpdateOperationsInput | string | null
    publishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    crawledAt?: DateTimeFieldUpdateOperationsInput | Date | string
    processedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
  }

  export type KnowledgeChunkCreateManyDocumentInput = {
    id?: string
    chunkIndex: number
    text: string
    tokenCount?: number | null
    vectorId: string
    embeddedAt?: Date | string
  }

  export type KnowledgeReviewItemCreateManyDocumentInput = {
    id?: string
    reason?: string | null
    status?: $Enums.KnowledgeReviewStatus
    reviewedBy?: string | null
    reviewedAt?: Date | string | null
  }

  export type KnowledgeChunkUpdateWithoutDocumentInput = {
    id?: StringFieldUpdateOperationsInput | string
    chunkIndex?: IntFieldUpdateOperationsInput | number
    text?: StringFieldUpdateOperationsInput | string
    tokenCount?: NullableIntFieldUpdateOperationsInput | number | null
    vectorId?: StringFieldUpdateOperationsInput | string
    embeddedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type KnowledgeChunkUncheckedUpdateWithoutDocumentInput = {
    id?: StringFieldUpdateOperationsInput | string
    chunkIndex?: IntFieldUpdateOperationsInput | number
    text?: StringFieldUpdateOperationsInput | string
    tokenCount?: NullableIntFieldUpdateOperationsInput | number | null
    vectorId?: StringFieldUpdateOperationsInput | string
    embeddedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type KnowledgeChunkUncheckedUpdateManyWithoutDocumentInput = {
    id?: StringFieldUpdateOperationsInput | string
    chunkIndex?: IntFieldUpdateOperationsInput | number
    text?: StringFieldUpdateOperationsInput | string
    tokenCount?: NullableIntFieldUpdateOperationsInput | number | null
    vectorId?: StringFieldUpdateOperationsInput | string
    embeddedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type KnowledgeReviewItemUpdateWithoutDocumentInput = {
    id?: StringFieldUpdateOperationsInput | string
    reason?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumKnowledgeReviewStatusFieldUpdateOperationsInput | $Enums.KnowledgeReviewStatus
    reviewedBy?: NullableStringFieldUpdateOperationsInput | string | null
    reviewedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
  }

  export type KnowledgeReviewItemUncheckedUpdateWithoutDocumentInput = {
    id?: StringFieldUpdateOperationsInput | string
    reason?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumKnowledgeReviewStatusFieldUpdateOperationsInput | $Enums.KnowledgeReviewStatus
    reviewedBy?: NullableStringFieldUpdateOperationsInput | string | null
    reviewedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
  }

  export type KnowledgeReviewItemUncheckedUpdateManyWithoutDocumentInput = {
    id?: StringFieldUpdateOperationsInput | string
    reason?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumKnowledgeReviewStatusFieldUpdateOperationsInput | $Enums.KnowledgeReviewStatus
    reviewedBy?: NullableStringFieldUpdateOperationsInput | string | null
    reviewedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
  }



  /**
   * Aliases for legacy arg types
   */
    /**
     * @deprecated Use WorkoutPlanCountOutputTypeDefaultArgs instead
     */
    export type WorkoutPlanCountOutputTypeArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = WorkoutPlanCountOutputTypeDefaultArgs<ExtArgs>
    /**
     * @deprecated Use PublishedPlanCountOutputTypeDefaultArgs instead
     */
    export type PublishedPlanCountOutputTypeArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = PublishedPlanCountOutputTypeDefaultArgs<ExtArgs>
    /**
     * @deprecated Use TrainingPackageCountOutputTypeDefaultArgs instead
     */
    export type TrainingPackageCountOutputTypeArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = TrainingPackageCountOutputTypeDefaultArgs<ExtArgs>
    /**
     * @deprecated Use KnowledgeSourceCountOutputTypeDefaultArgs instead
     */
    export type KnowledgeSourceCountOutputTypeArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = KnowledgeSourceCountOutputTypeDefaultArgs<ExtArgs>
    /**
     * @deprecated Use KnowledgeDocumentCountOutputTypeDefaultArgs instead
     */
    export type KnowledgeDocumentCountOutputTypeArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = KnowledgeDocumentCountOutputTypeDefaultArgs<ExtArgs>
    /**
     * @deprecated Use ConversationDefaultArgs instead
     */
    export type ConversationArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = ConversationDefaultArgs<ExtArgs>
    /**
     * @deprecated Use ChatSessionDefaultArgs instead
     */
    export type ChatSessionArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = ChatSessionDefaultArgs<ExtArgs>
    /**
     * @deprecated Use UserMemoryDefaultArgs instead
     */
    export type UserMemoryArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = UserMemoryDefaultArgs<ExtArgs>
    /**
     * @deprecated Use WorkoutPlanDefaultArgs instead
     */
    export type WorkoutPlanArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = WorkoutPlanDefaultArgs<ExtArgs>
    /**
     * @deprecated Use PublishedPlanDefaultArgs instead
     */
    export type PublishedPlanArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = PublishedPlanDefaultArgs<ExtArgs>
    /**
     * @deprecated Use PlanReviewDefaultArgs instead
     */
    export type PlanReviewArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = PlanReviewDefaultArgs<ExtArgs>
    /**
     * @deprecated Use TrainingPackageDefaultArgs instead
     */
    export type TrainingPackageArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = TrainingPackageDefaultArgs<ExtArgs>
    /**
     * @deprecated Use TrainingPackagePurchaseDefaultArgs instead
     */
    export type TrainingPackagePurchaseArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = TrainingPackagePurchaseDefaultArgs<ExtArgs>
    /**
     * @deprecated Use NutritionPlanDefaultArgs instead
     */
    export type NutritionPlanArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = NutritionPlanDefaultArgs<ExtArgs>
    /**
     * @deprecated Use KnowledgeSourceDefaultArgs instead
     */
    export type KnowledgeSourceArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = KnowledgeSourceDefaultArgs<ExtArgs>
    /**
     * @deprecated Use KnowledgeDocumentDefaultArgs instead
     */
    export type KnowledgeDocumentArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = KnowledgeDocumentDefaultArgs<ExtArgs>
    /**
     * @deprecated Use KnowledgeChunkDefaultArgs instead
     */
    export type KnowledgeChunkArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = KnowledgeChunkDefaultArgs<ExtArgs>
    /**
     * @deprecated Use KnowledgePipelineRunDefaultArgs instead
     */
    export type KnowledgePipelineRunArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = KnowledgePipelineRunDefaultArgs<ExtArgs>
    /**
     * @deprecated Use KnowledgeReviewItemDefaultArgs instead
     */
    export type KnowledgeReviewItemArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = KnowledgeReviewItemDefaultArgs<ExtArgs>

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