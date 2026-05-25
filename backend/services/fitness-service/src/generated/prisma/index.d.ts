
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
 * Model Exercise
 * 
 */
export type Exercise = $Result.DefaultSelection<Prisma.$ExercisePayload>
/**
 * Model Workout
 * 
 */
export type Workout = $Result.DefaultSelection<Prisma.$WorkoutPayload>
/**
 * Model WorkoutExercise
 * 
 */
export type WorkoutExercise = $Result.DefaultSelection<Prisma.$WorkoutExercisePayload>
/**
 * Model WorkoutSet
 * 
 */
export type WorkoutSet = $Result.DefaultSelection<Prisma.$WorkoutSetPayload>
/**
 * Model Food
 * 
 */
export type Food = $Result.DefaultSelection<Prisma.$FoodPayload>
/**
 * Model NutritionLog
 * 
 */
export type NutritionLog = $Result.DefaultSelection<Prisma.$NutritionLogPayload>
/**
 * Model NutritionGoal
 * 
 */
export type NutritionGoal = $Result.DefaultSelection<Prisma.$NutritionGoalPayload>
/**
 * Model BodyMetrics
 * 
 */
export type BodyMetrics = $Result.DefaultSelection<Prisma.$BodyMetricsPayload>
/**
 * Model WorkoutProgram
 * 
 */
export type WorkoutProgram = $Result.DefaultSelection<Prisma.$WorkoutProgramPayload>
/**
 * Model WorkoutProgramDay
 * 
 */
export type WorkoutProgramDay = $Result.DefaultSelection<Prisma.$WorkoutProgramDayPayload>
/**
 * Model WorkoutProgramExercise
 * 
 */
export type WorkoutProgramExercise = $Result.DefaultSelection<Prisma.$WorkoutProgramExercisePayload>
/**
 * Model WorkoutSchedule
 * 
 */
export type WorkoutSchedule = $Result.DefaultSelection<Prisma.$WorkoutSchedulePayload>

/**
 * Enums
 */
export namespace $Enums {
  export const ExerciseType: {
  STRENGTH: 'STRENGTH',
  CARDIO: 'CARDIO',
  MOBILITY: 'MOBILITY',
  STRENGTH_CARDIO: 'STRENGTH_CARDIO',
  STRENGTH_MOBILITY: 'STRENGTH_MOBILITY'
};

export type ExerciseType = (typeof ExerciseType)[keyof typeof ExerciseType]


export const EquipmentType: {
  BODYWEIGHT: 'BODYWEIGHT',
  BARBELL: 'BARBELL',
  DUMBBELLS: 'DUMBBELLS',
  KETTLEBELL: 'KETTLEBELL',
  MACHINE: 'MACHINE',
  RESISTANCE_BAND: 'RESISTANCE_BAND',
  CABLE: 'CABLE',
  MEDICINE_BALL: 'MEDICINE_BALL',
  FOAM_ROLLER: 'FOAM_ROLLER'
};

export type EquipmentType = (typeof EquipmentType)[keyof typeof EquipmentType]


export const BodyPart: {
  UPPER_BODY: 'UPPER_BODY',
  LOWER_BODY: 'LOWER_BODY',
  CORE: 'CORE',
  FULL_BODY: 'FULL_BODY'
};

export type BodyPart = (typeof BodyPart)[keyof typeof BodyPart]


export const MovementType: {
  PUSH: 'PUSH',
  PULL: 'PULL',
  HOLD: 'HOLD',
  STRETCH: 'STRETCH'
};

export type MovementType = (typeof MovementType)[keyof typeof MovementType]

}

export type ExerciseType = $Enums.ExerciseType

export const ExerciseType: typeof $Enums.ExerciseType

export type EquipmentType = $Enums.EquipmentType

export const EquipmentType: typeof $Enums.EquipmentType

export type BodyPart = $Enums.BodyPart

export const BodyPart: typeof $Enums.BodyPart

export type MovementType = $Enums.MovementType

export const MovementType: typeof $Enums.MovementType

/**
 * ##  Prisma Client ʲˢ
 * 
 * Type-safe database client for TypeScript & Node.js
 * @example
 * ```
 * const prisma = new PrismaClient()
 * // Fetch zero or more Exercises
 * const exercises = await prisma.exercise.findMany()
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
   * // Fetch zero or more Exercises
   * const exercises = await prisma.exercise.findMany()
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
   * `prisma.exercise`: Exposes CRUD operations for the **Exercise** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Exercises
    * const exercises = await prisma.exercise.findMany()
    * ```
    */
  get exercise(): Prisma.ExerciseDelegate<ExtArgs>;

  /**
   * `prisma.workout`: Exposes CRUD operations for the **Workout** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Workouts
    * const workouts = await prisma.workout.findMany()
    * ```
    */
  get workout(): Prisma.WorkoutDelegate<ExtArgs>;

  /**
   * `prisma.workoutExercise`: Exposes CRUD operations for the **WorkoutExercise** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more WorkoutExercises
    * const workoutExercises = await prisma.workoutExercise.findMany()
    * ```
    */
  get workoutExercise(): Prisma.WorkoutExerciseDelegate<ExtArgs>;

  /**
   * `prisma.workoutSet`: Exposes CRUD operations for the **WorkoutSet** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more WorkoutSets
    * const workoutSets = await prisma.workoutSet.findMany()
    * ```
    */
  get workoutSet(): Prisma.WorkoutSetDelegate<ExtArgs>;

  /**
   * `prisma.food`: Exposes CRUD operations for the **Food** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Foods
    * const foods = await prisma.food.findMany()
    * ```
    */
  get food(): Prisma.FoodDelegate<ExtArgs>;

  /**
   * `prisma.nutritionLog`: Exposes CRUD operations for the **NutritionLog** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more NutritionLogs
    * const nutritionLogs = await prisma.nutritionLog.findMany()
    * ```
    */
  get nutritionLog(): Prisma.NutritionLogDelegate<ExtArgs>;

  /**
   * `prisma.nutritionGoal`: Exposes CRUD operations for the **NutritionGoal** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more NutritionGoals
    * const nutritionGoals = await prisma.nutritionGoal.findMany()
    * ```
    */
  get nutritionGoal(): Prisma.NutritionGoalDelegate<ExtArgs>;

  /**
   * `prisma.bodyMetrics`: Exposes CRUD operations for the **BodyMetrics** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more BodyMetrics
    * const bodyMetrics = await prisma.bodyMetrics.findMany()
    * ```
    */
  get bodyMetrics(): Prisma.BodyMetricsDelegate<ExtArgs>;

  /**
   * `prisma.workoutProgram`: Exposes CRUD operations for the **WorkoutProgram** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more WorkoutPrograms
    * const workoutPrograms = await prisma.workoutProgram.findMany()
    * ```
    */
  get workoutProgram(): Prisma.WorkoutProgramDelegate<ExtArgs>;

  /**
   * `prisma.workoutProgramDay`: Exposes CRUD operations for the **WorkoutProgramDay** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more WorkoutProgramDays
    * const workoutProgramDays = await prisma.workoutProgramDay.findMany()
    * ```
    */
  get workoutProgramDay(): Prisma.WorkoutProgramDayDelegate<ExtArgs>;

  /**
   * `prisma.workoutProgramExercise`: Exposes CRUD operations for the **WorkoutProgramExercise** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more WorkoutProgramExercises
    * const workoutProgramExercises = await prisma.workoutProgramExercise.findMany()
    * ```
    */
  get workoutProgramExercise(): Prisma.WorkoutProgramExerciseDelegate<ExtArgs>;

  /**
   * `prisma.workoutSchedule`: Exposes CRUD operations for the **WorkoutSchedule** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more WorkoutSchedules
    * const workoutSchedules = await prisma.workoutSchedule.findMany()
    * ```
    */
  get workoutSchedule(): Prisma.WorkoutScheduleDelegate<ExtArgs>;
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
    Exercise: 'Exercise',
    Workout: 'Workout',
    WorkoutExercise: 'WorkoutExercise',
    WorkoutSet: 'WorkoutSet',
    Food: 'Food',
    NutritionLog: 'NutritionLog',
    NutritionGoal: 'NutritionGoal',
    BodyMetrics: 'BodyMetrics',
    WorkoutProgram: 'WorkoutProgram',
    WorkoutProgramDay: 'WorkoutProgramDay',
    WorkoutProgramExercise: 'WorkoutProgramExercise',
    WorkoutSchedule: 'WorkoutSchedule'
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
      modelProps: "exercise" | "workout" | "workoutExercise" | "workoutSet" | "food" | "nutritionLog" | "nutritionGoal" | "bodyMetrics" | "workoutProgram" | "workoutProgramDay" | "workoutProgramExercise" | "workoutSchedule"
      txIsolationLevel: Prisma.TransactionIsolationLevel
    }
    model: {
      Exercise: {
        payload: Prisma.$ExercisePayload<ExtArgs>
        fields: Prisma.ExerciseFieldRefs
        operations: {
          findUnique: {
            args: Prisma.ExerciseFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ExercisePayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.ExerciseFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ExercisePayload>
          }
          findFirst: {
            args: Prisma.ExerciseFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ExercisePayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.ExerciseFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ExercisePayload>
          }
          findMany: {
            args: Prisma.ExerciseFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ExercisePayload>[]
          }
          create: {
            args: Prisma.ExerciseCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ExercisePayload>
          }
          createMany: {
            args: Prisma.ExerciseCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.ExerciseCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ExercisePayload>[]
          }
          delete: {
            args: Prisma.ExerciseDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ExercisePayload>
          }
          update: {
            args: Prisma.ExerciseUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ExercisePayload>
          }
          deleteMany: {
            args: Prisma.ExerciseDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.ExerciseUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.ExerciseUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ExercisePayload>
          }
          aggregate: {
            args: Prisma.ExerciseAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateExercise>
          }
          groupBy: {
            args: Prisma.ExerciseGroupByArgs<ExtArgs>
            result: $Utils.Optional<ExerciseGroupByOutputType>[]
          }
          count: {
            args: Prisma.ExerciseCountArgs<ExtArgs>
            result: $Utils.Optional<ExerciseCountAggregateOutputType> | number
          }
        }
      }
      Workout: {
        payload: Prisma.$WorkoutPayload<ExtArgs>
        fields: Prisma.WorkoutFieldRefs
        operations: {
          findUnique: {
            args: Prisma.WorkoutFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.WorkoutFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutPayload>
          }
          findFirst: {
            args: Prisma.WorkoutFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.WorkoutFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutPayload>
          }
          findMany: {
            args: Prisma.WorkoutFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutPayload>[]
          }
          create: {
            args: Prisma.WorkoutCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutPayload>
          }
          createMany: {
            args: Prisma.WorkoutCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.WorkoutCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutPayload>[]
          }
          delete: {
            args: Prisma.WorkoutDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutPayload>
          }
          update: {
            args: Prisma.WorkoutUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutPayload>
          }
          deleteMany: {
            args: Prisma.WorkoutDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.WorkoutUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.WorkoutUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutPayload>
          }
          aggregate: {
            args: Prisma.WorkoutAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateWorkout>
          }
          groupBy: {
            args: Prisma.WorkoutGroupByArgs<ExtArgs>
            result: $Utils.Optional<WorkoutGroupByOutputType>[]
          }
          count: {
            args: Prisma.WorkoutCountArgs<ExtArgs>
            result: $Utils.Optional<WorkoutCountAggregateOutputType> | number
          }
        }
      }
      WorkoutExercise: {
        payload: Prisma.$WorkoutExercisePayload<ExtArgs>
        fields: Prisma.WorkoutExerciseFieldRefs
        operations: {
          findUnique: {
            args: Prisma.WorkoutExerciseFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutExercisePayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.WorkoutExerciseFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutExercisePayload>
          }
          findFirst: {
            args: Prisma.WorkoutExerciseFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutExercisePayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.WorkoutExerciseFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutExercisePayload>
          }
          findMany: {
            args: Prisma.WorkoutExerciseFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutExercisePayload>[]
          }
          create: {
            args: Prisma.WorkoutExerciseCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutExercisePayload>
          }
          createMany: {
            args: Prisma.WorkoutExerciseCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.WorkoutExerciseCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutExercisePayload>[]
          }
          delete: {
            args: Prisma.WorkoutExerciseDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutExercisePayload>
          }
          update: {
            args: Prisma.WorkoutExerciseUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutExercisePayload>
          }
          deleteMany: {
            args: Prisma.WorkoutExerciseDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.WorkoutExerciseUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.WorkoutExerciseUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutExercisePayload>
          }
          aggregate: {
            args: Prisma.WorkoutExerciseAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateWorkoutExercise>
          }
          groupBy: {
            args: Prisma.WorkoutExerciseGroupByArgs<ExtArgs>
            result: $Utils.Optional<WorkoutExerciseGroupByOutputType>[]
          }
          count: {
            args: Prisma.WorkoutExerciseCountArgs<ExtArgs>
            result: $Utils.Optional<WorkoutExerciseCountAggregateOutputType> | number
          }
        }
      }
      WorkoutSet: {
        payload: Prisma.$WorkoutSetPayload<ExtArgs>
        fields: Prisma.WorkoutSetFieldRefs
        operations: {
          findUnique: {
            args: Prisma.WorkoutSetFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutSetPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.WorkoutSetFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutSetPayload>
          }
          findFirst: {
            args: Prisma.WorkoutSetFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutSetPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.WorkoutSetFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutSetPayload>
          }
          findMany: {
            args: Prisma.WorkoutSetFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutSetPayload>[]
          }
          create: {
            args: Prisma.WorkoutSetCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutSetPayload>
          }
          createMany: {
            args: Prisma.WorkoutSetCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.WorkoutSetCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutSetPayload>[]
          }
          delete: {
            args: Prisma.WorkoutSetDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutSetPayload>
          }
          update: {
            args: Prisma.WorkoutSetUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutSetPayload>
          }
          deleteMany: {
            args: Prisma.WorkoutSetDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.WorkoutSetUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.WorkoutSetUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutSetPayload>
          }
          aggregate: {
            args: Prisma.WorkoutSetAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateWorkoutSet>
          }
          groupBy: {
            args: Prisma.WorkoutSetGroupByArgs<ExtArgs>
            result: $Utils.Optional<WorkoutSetGroupByOutputType>[]
          }
          count: {
            args: Prisma.WorkoutSetCountArgs<ExtArgs>
            result: $Utils.Optional<WorkoutSetCountAggregateOutputType> | number
          }
        }
      }
      Food: {
        payload: Prisma.$FoodPayload<ExtArgs>
        fields: Prisma.FoodFieldRefs
        operations: {
          findUnique: {
            args: Prisma.FoodFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$FoodPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.FoodFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$FoodPayload>
          }
          findFirst: {
            args: Prisma.FoodFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$FoodPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.FoodFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$FoodPayload>
          }
          findMany: {
            args: Prisma.FoodFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$FoodPayload>[]
          }
          create: {
            args: Prisma.FoodCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$FoodPayload>
          }
          createMany: {
            args: Prisma.FoodCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.FoodCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$FoodPayload>[]
          }
          delete: {
            args: Prisma.FoodDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$FoodPayload>
          }
          update: {
            args: Prisma.FoodUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$FoodPayload>
          }
          deleteMany: {
            args: Prisma.FoodDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.FoodUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.FoodUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$FoodPayload>
          }
          aggregate: {
            args: Prisma.FoodAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateFood>
          }
          groupBy: {
            args: Prisma.FoodGroupByArgs<ExtArgs>
            result: $Utils.Optional<FoodGroupByOutputType>[]
          }
          count: {
            args: Prisma.FoodCountArgs<ExtArgs>
            result: $Utils.Optional<FoodCountAggregateOutputType> | number
          }
        }
      }
      NutritionLog: {
        payload: Prisma.$NutritionLogPayload<ExtArgs>
        fields: Prisma.NutritionLogFieldRefs
        operations: {
          findUnique: {
            args: Prisma.NutritionLogFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$NutritionLogPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.NutritionLogFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$NutritionLogPayload>
          }
          findFirst: {
            args: Prisma.NutritionLogFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$NutritionLogPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.NutritionLogFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$NutritionLogPayload>
          }
          findMany: {
            args: Prisma.NutritionLogFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$NutritionLogPayload>[]
          }
          create: {
            args: Prisma.NutritionLogCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$NutritionLogPayload>
          }
          createMany: {
            args: Prisma.NutritionLogCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.NutritionLogCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$NutritionLogPayload>[]
          }
          delete: {
            args: Prisma.NutritionLogDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$NutritionLogPayload>
          }
          update: {
            args: Prisma.NutritionLogUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$NutritionLogPayload>
          }
          deleteMany: {
            args: Prisma.NutritionLogDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.NutritionLogUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.NutritionLogUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$NutritionLogPayload>
          }
          aggregate: {
            args: Prisma.NutritionLogAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateNutritionLog>
          }
          groupBy: {
            args: Prisma.NutritionLogGroupByArgs<ExtArgs>
            result: $Utils.Optional<NutritionLogGroupByOutputType>[]
          }
          count: {
            args: Prisma.NutritionLogCountArgs<ExtArgs>
            result: $Utils.Optional<NutritionLogCountAggregateOutputType> | number
          }
        }
      }
      NutritionGoal: {
        payload: Prisma.$NutritionGoalPayload<ExtArgs>
        fields: Prisma.NutritionGoalFieldRefs
        operations: {
          findUnique: {
            args: Prisma.NutritionGoalFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$NutritionGoalPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.NutritionGoalFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$NutritionGoalPayload>
          }
          findFirst: {
            args: Prisma.NutritionGoalFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$NutritionGoalPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.NutritionGoalFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$NutritionGoalPayload>
          }
          findMany: {
            args: Prisma.NutritionGoalFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$NutritionGoalPayload>[]
          }
          create: {
            args: Prisma.NutritionGoalCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$NutritionGoalPayload>
          }
          createMany: {
            args: Prisma.NutritionGoalCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.NutritionGoalCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$NutritionGoalPayload>[]
          }
          delete: {
            args: Prisma.NutritionGoalDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$NutritionGoalPayload>
          }
          update: {
            args: Prisma.NutritionGoalUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$NutritionGoalPayload>
          }
          deleteMany: {
            args: Prisma.NutritionGoalDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.NutritionGoalUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.NutritionGoalUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$NutritionGoalPayload>
          }
          aggregate: {
            args: Prisma.NutritionGoalAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateNutritionGoal>
          }
          groupBy: {
            args: Prisma.NutritionGoalGroupByArgs<ExtArgs>
            result: $Utils.Optional<NutritionGoalGroupByOutputType>[]
          }
          count: {
            args: Prisma.NutritionGoalCountArgs<ExtArgs>
            result: $Utils.Optional<NutritionGoalCountAggregateOutputType> | number
          }
        }
      }
      BodyMetrics: {
        payload: Prisma.$BodyMetricsPayload<ExtArgs>
        fields: Prisma.BodyMetricsFieldRefs
        operations: {
          findUnique: {
            args: Prisma.BodyMetricsFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$BodyMetricsPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.BodyMetricsFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$BodyMetricsPayload>
          }
          findFirst: {
            args: Prisma.BodyMetricsFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$BodyMetricsPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.BodyMetricsFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$BodyMetricsPayload>
          }
          findMany: {
            args: Prisma.BodyMetricsFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$BodyMetricsPayload>[]
          }
          create: {
            args: Prisma.BodyMetricsCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$BodyMetricsPayload>
          }
          createMany: {
            args: Prisma.BodyMetricsCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.BodyMetricsCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$BodyMetricsPayload>[]
          }
          delete: {
            args: Prisma.BodyMetricsDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$BodyMetricsPayload>
          }
          update: {
            args: Prisma.BodyMetricsUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$BodyMetricsPayload>
          }
          deleteMany: {
            args: Prisma.BodyMetricsDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.BodyMetricsUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.BodyMetricsUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$BodyMetricsPayload>
          }
          aggregate: {
            args: Prisma.BodyMetricsAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateBodyMetrics>
          }
          groupBy: {
            args: Prisma.BodyMetricsGroupByArgs<ExtArgs>
            result: $Utils.Optional<BodyMetricsGroupByOutputType>[]
          }
          count: {
            args: Prisma.BodyMetricsCountArgs<ExtArgs>
            result: $Utils.Optional<BodyMetricsCountAggregateOutputType> | number
          }
        }
      }
      WorkoutProgram: {
        payload: Prisma.$WorkoutProgramPayload<ExtArgs>
        fields: Prisma.WorkoutProgramFieldRefs
        operations: {
          findUnique: {
            args: Prisma.WorkoutProgramFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutProgramPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.WorkoutProgramFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutProgramPayload>
          }
          findFirst: {
            args: Prisma.WorkoutProgramFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutProgramPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.WorkoutProgramFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutProgramPayload>
          }
          findMany: {
            args: Prisma.WorkoutProgramFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutProgramPayload>[]
          }
          create: {
            args: Prisma.WorkoutProgramCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutProgramPayload>
          }
          createMany: {
            args: Prisma.WorkoutProgramCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.WorkoutProgramCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutProgramPayload>[]
          }
          delete: {
            args: Prisma.WorkoutProgramDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutProgramPayload>
          }
          update: {
            args: Prisma.WorkoutProgramUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutProgramPayload>
          }
          deleteMany: {
            args: Prisma.WorkoutProgramDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.WorkoutProgramUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.WorkoutProgramUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutProgramPayload>
          }
          aggregate: {
            args: Prisma.WorkoutProgramAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateWorkoutProgram>
          }
          groupBy: {
            args: Prisma.WorkoutProgramGroupByArgs<ExtArgs>
            result: $Utils.Optional<WorkoutProgramGroupByOutputType>[]
          }
          count: {
            args: Prisma.WorkoutProgramCountArgs<ExtArgs>
            result: $Utils.Optional<WorkoutProgramCountAggregateOutputType> | number
          }
        }
      }
      WorkoutProgramDay: {
        payload: Prisma.$WorkoutProgramDayPayload<ExtArgs>
        fields: Prisma.WorkoutProgramDayFieldRefs
        operations: {
          findUnique: {
            args: Prisma.WorkoutProgramDayFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutProgramDayPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.WorkoutProgramDayFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutProgramDayPayload>
          }
          findFirst: {
            args: Prisma.WorkoutProgramDayFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutProgramDayPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.WorkoutProgramDayFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutProgramDayPayload>
          }
          findMany: {
            args: Prisma.WorkoutProgramDayFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutProgramDayPayload>[]
          }
          create: {
            args: Prisma.WorkoutProgramDayCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutProgramDayPayload>
          }
          createMany: {
            args: Prisma.WorkoutProgramDayCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.WorkoutProgramDayCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutProgramDayPayload>[]
          }
          delete: {
            args: Prisma.WorkoutProgramDayDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutProgramDayPayload>
          }
          update: {
            args: Prisma.WorkoutProgramDayUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutProgramDayPayload>
          }
          deleteMany: {
            args: Prisma.WorkoutProgramDayDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.WorkoutProgramDayUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.WorkoutProgramDayUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutProgramDayPayload>
          }
          aggregate: {
            args: Prisma.WorkoutProgramDayAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateWorkoutProgramDay>
          }
          groupBy: {
            args: Prisma.WorkoutProgramDayGroupByArgs<ExtArgs>
            result: $Utils.Optional<WorkoutProgramDayGroupByOutputType>[]
          }
          count: {
            args: Prisma.WorkoutProgramDayCountArgs<ExtArgs>
            result: $Utils.Optional<WorkoutProgramDayCountAggregateOutputType> | number
          }
        }
      }
      WorkoutProgramExercise: {
        payload: Prisma.$WorkoutProgramExercisePayload<ExtArgs>
        fields: Prisma.WorkoutProgramExerciseFieldRefs
        operations: {
          findUnique: {
            args: Prisma.WorkoutProgramExerciseFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutProgramExercisePayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.WorkoutProgramExerciseFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutProgramExercisePayload>
          }
          findFirst: {
            args: Prisma.WorkoutProgramExerciseFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutProgramExercisePayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.WorkoutProgramExerciseFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutProgramExercisePayload>
          }
          findMany: {
            args: Prisma.WorkoutProgramExerciseFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutProgramExercisePayload>[]
          }
          create: {
            args: Prisma.WorkoutProgramExerciseCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutProgramExercisePayload>
          }
          createMany: {
            args: Prisma.WorkoutProgramExerciseCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.WorkoutProgramExerciseCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutProgramExercisePayload>[]
          }
          delete: {
            args: Prisma.WorkoutProgramExerciseDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutProgramExercisePayload>
          }
          update: {
            args: Prisma.WorkoutProgramExerciseUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutProgramExercisePayload>
          }
          deleteMany: {
            args: Prisma.WorkoutProgramExerciseDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.WorkoutProgramExerciseUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.WorkoutProgramExerciseUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutProgramExercisePayload>
          }
          aggregate: {
            args: Prisma.WorkoutProgramExerciseAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateWorkoutProgramExercise>
          }
          groupBy: {
            args: Prisma.WorkoutProgramExerciseGroupByArgs<ExtArgs>
            result: $Utils.Optional<WorkoutProgramExerciseGroupByOutputType>[]
          }
          count: {
            args: Prisma.WorkoutProgramExerciseCountArgs<ExtArgs>
            result: $Utils.Optional<WorkoutProgramExerciseCountAggregateOutputType> | number
          }
        }
      }
      WorkoutSchedule: {
        payload: Prisma.$WorkoutSchedulePayload<ExtArgs>
        fields: Prisma.WorkoutScheduleFieldRefs
        operations: {
          findUnique: {
            args: Prisma.WorkoutScheduleFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutSchedulePayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.WorkoutScheduleFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutSchedulePayload>
          }
          findFirst: {
            args: Prisma.WorkoutScheduleFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutSchedulePayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.WorkoutScheduleFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutSchedulePayload>
          }
          findMany: {
            args: Prisma.WorkoutScheduleFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutSchedulePayload>[]
          }
          create: {
            args: Prisma.WorkoutScheduleCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutSchedulePayload>
          }
          createMany: {
            args: Prisma.WorkoutScheduleCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.WorkoutScheduleCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutSchedulePayload>[]
          }
          delete: {
            args: Prisma.WorkoutScheduleDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutSchedulePayload>
          }
          update: {
            args: Prisma.WorkoutScheduleUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutSchedulePayload>
          }
          deleteMany: {
            args: Prisma.WorkoutScheduleDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.WorkoutScheduleUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.WorkoutScheduleUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WorkoutSchedulePayload>
          }
          aggregate: {
            args: Prisma.WorkoutScheduleAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateWorkoutSchedule>
          }
          groupBy: {
            args: Prisma.WorkoutScheduleGroupByArgs<ExtArgs>
            result: $Utils.Optional<WorkoutScheduleGroupByOutputType>[]
          }
          count: {
            args: Prisma.WorkoutScheduleCountArgs<ExtArgs>
            result: $Utils.Optional<WorkoutScheduleCountAggregateOutputType> | number
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
   * Count Type ExerciseCountOutputType
   */

  export type ExerciseCountOutputType = {
    workoutExercises: number
    workoutProgramExercises: number
  }

  export type ExerciseCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    workoutExercises?: boolean | ExerciseCountOutputTypeCountWorkoutExercisesArgs
    workoutProgramExercises?: boolean | ExerciseCountOutputTypeCountWorkoutProgramExercisesArgs
  }

  // Custom InputTypes
  /**
   * ExerciseCountOutputType without action
   */
  export type ExerciseCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ExerciseCountOutputType
     */
    select?: ExerciseCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * ExerciseCountOutputType without action
   */
  export type ExerciseCountOutputTypeCountWorkoutExercisesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: WorkoutExerciseWhereInput
  }

  /**
   * ExerciseCountOutputType without action
   */
  export type ExerciseCountOutputTypeCountWorkoutProgramExercisesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: WorkoutProgramExerciseWhereInput
  }


  /**
   * Count Type WorkoutCountOutputType
   */

  export type WorkoutCountOutputType = {
    exercises: number
    schedules: number
  }

  export type WorkoutCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    exercises?: boolean | WorkoutCountOutputTypeCountExercisesArgs
    schedules?: boolean | WorkoutCountOutputTypeCountSchedulesArgs
  }

  // Custom InputTypes
  /**
   * WorkoutCountOutputType without action
   */
  export type WorkoutCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutCountOutputType
     */
    select?: WorkoutCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * WorkoutCountOutputType without action
   */
  export type WorkoutCountOutputTypeCountExercisesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: WorkoutExerciseWhereInput
  }

  /**
   * WorkoutCountOutputType without action
   */
  export type WorkoutCountOutputTypeCountSchedulesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: WorkoutScheduleWhereInput
  }


  /**
   * Count Type WorkoutExerciseCountOutputType
   */

  export type WorkoutExerciseCountOutputType = {
    workoutSets: number
  }

  export type WorkoutExerciseCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    workoutSets?: boolean | WorkoutExerciseCountOutputTypeCountWorkoutSetsArgs
  }

  // Custom InputTypes
  /**
   * WorkoutExerciseCountOutputType without action
   */
  export type WorkoutExerciseCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutExerciseCountOutputType
     */
    select?: WorkoutExerciseCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * WorkoutExerciseCountOutputType without action
   */
  export type WorkoutExerciseCountOutputTypeCountWorkoutSetsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: WorkoutSetWhereInput
  }


  /**
   * Count Type WorkoutProgramCountOutputType
   */

  export type WorkoutProgramCountOutputType = {
    days: number
  }

  export type WorkoutProgramCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    days?: boolean | WorkoutProgramCountOutputTypeCountDaysArgs
  }

  // Custom InputTypes
  /**
   * WorkoutProgramCountOutputType without action
   */
  export type WorkoutProgramCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutProgramCountOutputType
     */
    select?: WorkoutProgramCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * WorkoutProgramCountOutputType without action
   */
  export type WorkoutProgramCountOutputTypeCountDaysArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: WorkoutProgramDayWhereInput
  }


  /**
   * Count Type WorkoutProgramDayCountOutputType
   */

  export type WorkoutProgramDayCountOutputType = {
    exercises: number
    schedules: number
  }

  export type WorkoutProgramDayCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    exercises?: boolean | WorkoutProgramDayCountOutputTypeCountExercisesArgs
    schedules?: boolean | WorkoutProgramDayCountOutputTypeCountSchedulesArgs
  }

  // Custom InputTypes
  /**
   * WorkoutProgramDayCountOutputType without action
   */
  export type WorkoutProgramDayCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutProgramDayCountOutputType
     */
    select?: WorkoutProgramDayCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * WorkoutProgramDayCountOutputType without action
   */
  export type WorkoutProgramDayCountOutputTypeCountExercisesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: WorkoutProgramExerciseWhereInput
  }

  /**
   * WorkoutProgramDayCountOutputType without action
   */
  export type WorkoutProgramDayCountOutputTypeCountSchedulesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: WorkoutScheduleWhereInput
  }


  /**
   * Models
   */

  /**
   * Model Exercise
   */

  export type AggregateExercise = {
    _count: ExerciseCountAggregateOutputType | null
    _min: ExerciseMinAggregateOutputType | null
    _max: ExerciseMaxAggregateOutputType | null
  }

  export type ExerciseMinAggregateOutputType = {
    id: string | null
    exerciseName: string | null
    typeOfActivity: $Enums.ExerciseType | null
    typeOfEquipment: $Enums.EquipmentType | null
    bodyPart: $Enums.BodyPart | null
    type: $Enums.MovementType | null
    instructions: string | null
    videoUrl: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type ExerciseMaxAggregateOutputType = {
    id: string | null
    exerciseName: string | null
    typeOfActivity: $Enums.ExerciseType | null
    typeOfEquipment: $Enums.EquipmentType | null
    bodyPart: $Enums.BodyPart | null
    type: $Enums.MovementType | null
    instructions: string | null
    videoUrl: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type ExerciseCountAggregateOutputType = {
    id: number
    exerciseName: number
    typeOfActivity: number
    typeOfEquipment: number
    bodyPart: number
    type: number
    muscleGroupsActivated: number
    instructions: number
    videoUrl: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type ExerciseMinAggregateInputType = {
    id?: true
    exerciseName?: true
    typeOfActivity?: true
    typeOfEquipment?: true
    bodyPart?: true
    type?: true
    instructions?: true
    videoUrl?: true
    createdAt?: true
    updatedAt?: true
  }

  export type ExerciseMaxAggregateInputType = {
    id?: true
    exerciseName?: true
    typeOfActivity?: true
    typeOfEquipment?: true
    bodyPart?: true
    type?: true
    instructions?: true
    videoUrl?: true
    createdAt?: true
    updatedAt?: true
  }

  export type ExerciseCountAggregateInputType = {
    id?: true
    exerciseName?: true
    typeOfActivity?: true
    typeOfEquipment?: true
    bodyPart?: true
    type?: true
    muscleGroupsActivated?: true
    instructions?: true
    videoUrl?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type ExerciseAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Exercise to aggregate.
     */
    where?: ExerciseWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Exercises to fetch.
     */
    orderBy?: ExerciseOrderByWithRelationInput | ExerciseOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: ExerciseWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Exercises from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Exercises.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Exercises
    **/
    _count?: true | ExerciseCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: ExerciseMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: ExerciseMaxAggregateInputType
  }

  export type GetExerciseAggregateType<T extends ExerciseAggregateArgs> = {
        [P in keyof T & keyof AggregateExercise]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateExercise[P]>
      : GetScalarType<T[P], AggregateExercise[P]>
  }




  export type ExerciseGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: ExerciseWhereInput
    orderBy?: ExerciseOrderByWithAggregationInput | ExerciseOrderByWithAggregationInput[]
    by: ExerciseScalarFieldEnum[] | ExerciseScalarFieldEnum
    having?: ExerciseScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: ExerciseCountAggregateInputType | true
    _min?: ExerciseMinAggregateInputType
    _max?: ExerciseMaxAggregateInputType
  }

  export type ExerciseGroupByOutputType = {
    id: string
    exerciseName: string
    typeOfActivity: $Enums.ExerciseType
    typeOfEquipment: $Enums.EquipmentType
    bodyPart: $Enums.BodyPart
    type: $Enums.MovementType
    muscleGroupsActivated: string[]
    instructions: string
    videoUrl: string | null
    createdAt: Date
    updatedAt: Date
    _count: ExerciseCountAggregateOutputType | null
    _min: ExerciseMinAggregateOutputType | null
    _max: ExerciseMaxAggregateOutputType | null
  }

  type GetExerciseGroupByPayload<T extends ExerciseGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<ExerciseGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof ExerciseGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], ExerciseGroupByOutputType[P]>
            : GetScalarType<T[P], ExerciseGroupByOutputType[P]>
        }
      >
    >


  export type ExerciseSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    exerciseName?: boolean
    typeOfActivity?: boolean
    typeOfEquipment?: boolean
    bodyPart?: boolean
    type?: boolean
    muscleGroupsActivated?: boolean
    instructions?: boolean
    videoUrl?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    workoutExercises?: boolean | Exercise$workoutExercisesArgs<ExtArgs>
    workoutProgramExercises?: boolean | Exercise$workoutProgramExercisesArgs<ExtArgs>
    _count?: boolean | ExerciseCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["exercise"]>

  export type ExerciseSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    exerciseName?: boolean
    typeOfActivity?: boolean
    typeOfEquipment?: boolean
    bodyPart?: boolean
    type?: boolean
    muscleGroupsActivated?: boolean
    instructions?: boolean
    videoUrl?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["exercise"]>

  export type ExerciseSelectScalar = {
    id?: boolean
    exerciseName?: boolean
    typeOfActivity?: boolean
    typeOfEquipment?: boolean
    bodyPart?: boolean
    type?: boolean
    muscleGroupsActivated?: boolean
    instructions?: boolean
    videoUrl?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type ExerciseInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    workoutExercises?: boolean | Exercise$workoutExercisesArgs<ExtArgs>
    workoutProgramExercises?: boolean | Exercise$workoutProgramExercisesArgs<ExtArgs>
    _count?: boolean | ExerciseCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type ExerciseIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {}

  export type $ExercisePayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "Exercise"
    objects: {
      workoutExercises: Prisma.$WorkoutExercisePayload<ExtArgs>[]
      workoutProgramExercises: Prisma.$WorkoutProgramExercisePayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      exerciseName: string
      typeOfActivity: $Enums.ExerciseType
      typeOfEquipment: $Enums.EquipmentType
      bodyPart: $Enums.BodyPart
      type: $Enums.MovementType
      muscleGroupsActivated: string[]
      instructions: string
      videoUrl: string | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["exercise"]>
    composites: {}
  }

  type ExerciseGetPayload<S extends boolean | null | undefined | ExerciseDefaultArgs> = $Result.GetResult<Prisma.$ExercisePayload, S>

  type ExerciseCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<ExerciseFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: ExerciseCountAggregateInputType | true
    }

  export interface ExerciseDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['Exercise'], meta: { name: 'Exercise' } }
    /**
     * Find zero or one Exercise that matches the filter.
     * @param {ExerciseFindUniqueArgs} args - Arguments to find a Exercise
     * @example
     * // Get one Exercise
     * const exercise = await prisma.exercise.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends ExerciseFindUniqueArgs>(args: SelectSubset<T, ExerciseFindUniqueArgs<ExtArgs>>): Prisma__ExerciseClient<$Result.GetResult<Prisma.$ExercisePayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one Exercise that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {ExerciseFindUniqueOrThrowArgs} args - Arguments to find a Exercise
     * @example
     * // Get one Exercise
     * const exercise = await prisma.exercise.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends ExerciseFindUniqueOrThrowArgs>(args: SelectSubset<T, ExerciseFindUniqueOrThrowArgs<ExtArgs>>): Prisma__ExerciseClient<$Result.GetResult<Prisma.$ExercisePayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first Exercise that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ExerciseFindFirstArgs} args - Arguments to find a Exercise
     * @example
     * // Get one Exercise
     * const exercise = await prisma.exercise.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends ExerciseFindFirstArgs>(args?: SelectSubset<T, ExerciseFindFirstArgs<ExtArgs>>): Prisma__ExerciseClient<$Result.GetResult<Prisma.$ExercisePayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first Exercise that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ExerciseFindFirstOrThrowArgs} args - Arguments to find a Exercise
     * @example
     * // Get one Exercise
     * const exercise = await prisma.exercise.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends ExerciseFindFirstOrThrowArgs>(args?: SelectSubset<T, ExerciseFindFirstOrThrowArgs<ExtArgs>>): Prisma__ExerciseClient<$Result.GetResult<Prisma.$ExercisePayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more Exercises that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ExerciseFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Exercises
     * const exercises = await prisma.exercise.findMany()
     * 
     * // Get first 10 Exercises
     * const exercises = await prisma.exercise.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const exerciseWithIdOnly = await prisma.exercise.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends ExerciseFindManyArgs>(args?: SelectSubset<T, ExerciseFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ExercisePayload<ExtArgs>, T, "findMany">>

    /**
     * Create a Exercise.
     * @param {ExerciseCreateArgs} args - Arguments to create a Exercise.
     * @example
     * // Create one Exercise
     * const Exercise = await prisma.exercise.create({
     *   data: {
     *     // ... data to create a Exercise
     *   }
     * })
     * 
     */
    create<T extends ExerciseCreateArgs>(args: SelectSubset<T, ExerciseCreateArgs<ExtArgs>>): Prisma__ExerciseClient<$Result.GetResult<Prisma.$ExercisePayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many Exercises.
     * @param {ExerciseCreateManyArgs} args - Arguments to create many Exercises.
     * @example
     * // Create many Exercises
     * const exercise = await prisma.exercise.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends ExerciseCreateManyArgs>(args?: SelectSubset<T, ExerciseCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Exercises and returns the data saved in the database.
     * @param {ExerciseCreateManyAndReturnArgs} args - Arguments to create many Exercises.
     * @example
     * // Create many Exercises
     * const exercise = await prisma.exercise.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Exercises and only return the `id`
     * const exerciseWithIdOnly = await prisma.exercise.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends ExerciseCreateManyAndReturnArgs>(args?: SelectSubset<T, ExerciseCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ExercisePayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a Exercise.
     * @param {ExerciseDeleteArgs} args - Arguments to delete one Exercise.
     * @example
     * // Delete one Exercise
     * const Exercise = await prisma.exercise.delete({
     *   where: {
     *     // ... filter to delete one Exercise
     *   }
     * })
     * 
     */
    delete<T extends ExerciseDeleteArgs>(args: SelectSubset<T, ExerciseDeleteArgs<ExtArgs>>): Prisma__ExerciseClient<$Result.GetResult<Prisma.$ExercisePayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one Exercise.
     * @param {ExerciseUpdateArgs} args - Arguments to update one Exercise.
     * @example
     * // Update one Exercise
     * const exercise = await prisma.exercise.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends ExerciseUpdateArgs>(args: SelectSubset<T, ExerciseUpdateArgs<ExtArgs>>): Prisma__ExerciseClient<$Result.GetResult<Prisma.$ExercisePayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more Exercises.
     * @param {ExerciseDeleteManyArgs} args - Arguments to filter Exercises to delete.
     * @example
     * // Delete a few Exercises
     * const { count } = await prisma.exercise.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends ExerciseDeleteManyArgs>(args?: SelectSubset<T, ExerciseDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Exercises.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ExerciseUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Exercises
     * const exercise = await prisma.exercise.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends ExerciseUpdateManyArgs>(args: SelectSubset<T, ExerciseUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one Exercise.
     * @param {ExerciseUpsertArgs} args - Arguments to update or create a Exercise.
     * @example
     * // Update or create a Exercise
     * const exercise = await prisma.exercise.upsert({
     *   create: {
     *     // ... data to create a Exercise
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Exercise we want to update
     *   }
     * })
     */
    upsert<T extends ExerciseUpsertArgs>(args: SelectSubset<T, ExerciseUpsertArgs<ExtArgs>>): Prisma__ExerciseClient<$Result.GetResult<Prisma.$ExercisePayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of Exercises.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ExerciseCountArgs} args - Arguments to filter Exercises to count.
     * @example
     * // Count the number of Exercises
     * const count = await prisma.exercise.count({
     *   where: {
     *     // ... the filter for the Exercises we want to count
     *   }
     * })
    **/
    count<T extends ExerciseCountArgs>(
      args?: Subset<T, ExerciseCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], ExerciseCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Exercise.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ExerciseAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends ExerciseAggregateArgs>(args: Subset<T, ExerciseAggregateArgs>): Prisma.PrismaPromise<GetExerciseAggregateType<T>>

    /**
     * Group by Exercise.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ExerciseGroupByArgs} args - Group by arguments.
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
      T extends ExerciseGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: ExerciseGroupByArgs['orderBy'] }
        : { orderBy?: ExerciseGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, ExerciseGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetExerciseGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the Exercise model
   */
  readonly fields: ExerciseFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for Exercise.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__ExerciseClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    workoutExercises<T extends Exercise$workoutExercisesArgs<ExtArgs> = {}>(args?: Subset<T, Exercise$workoutExercisesArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$WorkoutExercisePayload<ExtArgs>, T, "findMany"> | Null>
    workoutProgramExercises<T extends Exercise$workoutProgramExercisesArgs<ExtArgs> = {}>(args?: Subset<T, Exercise$workoutProgramExercisesArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$WorkoutProgramExercisePayload<ExtArgs>, T, "findMany"> | Null>
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
   * Fields of the Exercise model
   */ 
  interface ExerciseFieldRefs {
    readonly id: FieldRef<"Exercise", 'String'>
    readonly exerciseName: FieldRef<"Exercise", 'String'>
    readonly typeOfActivity: FieldRef<"Exercise", 'ExerciseType'>
    readonly typeOfEquipment: FieldRef<"Exercise", 'EquipmentType'>
    readonly bodyPart: FieldRef<"Exercise", 'BodyPart'>
    readonly type: FieldRef<"Exercise", 'MovementType'>
    readonly muscleGroupsActivated: FieldRef<"Exercise", 'String[]'>
    readonly instructions: FieldRef<"Exercise", 'String'>
    readonly videoUrl: FieldRef<"Exercise", 'String'>
    readonly createdAt: FieldRef<"Exercise", 'DateTime'>
    readonly updatedAt: FieldRef<"Exercise", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * Exercise findUnique
   */
  export type ExerciseFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Exercise
     */
    select?: ExerciseSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ExerciseInclude<ExtArgs> | null
    /**
     * Filter, which Exercise to fetch.
     */
    where: ExerciseWhereUniqueInput
  }

  /**
   * Exercise findUniqueOrThrow
   */
  export type ExerciseFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Exercise
     */
    select?: ExerciseSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ExerciseInclude<ExtArgs> | null
    /**
     * Filter, which Exercise to fetch.
     */
    where: ExerciseWhereUniqueInput
  }

  /**
   * Exercise findFirst
   */
  export type ExerciseFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Exercise
     */
    select?: ExerciseSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ExerciseInclude<ExtArgs> | null
    /**
     * Filter, which Exercise to fetch.
     */
    where?: ExerciseWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Exercises to fetch.
     */
    orderBy?: ExerciseOrderByWithRelationInput | ExerciseOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Exercises.
     */
    cursor?: ExerciseWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Exercises from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Exercises.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Exercises.
     */
    distinct?: ExerciseScalarFieldEnum | ExerciseScalarFieldEnum[]
  }

  /**
   * Exercise findFirstOrThrow
   */
  export type ExerciseFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Exercise
     */
    select?: ExerciseSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ExerciseInclude<ExtArgs> | null
    /**
     * Filter, which Exercise to fetch.
     */
    where?: ExerciseWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Exercises to fetch.
     */
    orderBy?: ExerciseOrderByWithRelationInput | ExerciseOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Exercises.
     */
    cursor?: ExerciseWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Exercises from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Exercises.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Exercises.
     */
    distinct?: ExerciseScalarFieldEnum | ExerciseScalarFieldEnum[]
  }

  /**
   * Exercise findMany
   */
  export type ExerciseFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Exercise
     */
    select?: ExerciseSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ExerciseInclude<ExtArgs> | null
    /**
     * Filter, which Exercises to fetch.
     */
    where?: ExerciseWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Exercises to fetch.
     */
    orderBy?: ExerciseOrderByWithRelationInput | ExerciseOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Exercises.
     */
    cursor?: ExerciseWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Exercises from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Exercises.
     */
    skip?: number
    distinct?: ExerciseScalarFieldEnum | ExerciseScalarFieldEnum[]
  }

  /**
   * Exercise create
   */
  export type ExerciseCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Exercise
     */
    select?: ExerciseSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ExerciseInclude<ExtArgs> | null
    /**
     * The data needed to create a Exercise.
     */
    data: XOR<ExerciseCreateInput, ExerciseUncheckedCreateInput>
  }

  /**
   * Exercise createMany
   */
  export type ExerciseCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Exercises.
     */
    data: ExerciseCreateManyInput | ExerciseCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Exercise createManyAndReturn
   */
  export type ExerciseCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Exercise
     */
    select?: ExerciseSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many Exercises.
     */
    data: ExerciseCreateManyInput | ExerciseCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Exercise update
   */
  export type ExerciseUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Exercise
     */
    select?: ExerciseSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ExerciseInclude<ExtArgs> | null
    /**
     * The data needed to update a Exercise.
     */
    data: XOR<ExerciseUpdateInput, ExerciseUncheckedUpdateInput>
    /**
     * Choose, which Exercise to update.
     */
    where: ExerciseWhereUniqueInput
  }

  /**
   * Exercise updateMany
   */
  export type ExerciseUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Exercises.
     */
    data: XOR<ExerciseUpdateManyMutationInput, ExerciseUncheckedUpdateManyInput>
    /**
     * Filter which Exercises to update
     */
    where?: ExerciseWhereInput
  }

  /**
   * Exercise upsert
   */
  export type ExerciseUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Exercise
     */
    select?: ExerciseSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ExerciseInclude<ExtArgs> | null
    /**
     * The filter to search for the Exercise to update in case it exists.
     */
    where: ExerciseWhereUniqueInput
    /**
     * In case the Exercise found by the `where` argument doesn't exist, create a new Exercise with this data.
     */
    create: XOR<ExerciseCreateInput, ExerciseUncheckedCreateInput>
    /**
     * In case the Exercise was found with the provided `where` argument, update it with this data.
     */
    update: XOR<ExerciseUpdateInput, ExerciseUncheckedUpdateInput>
  }

  /**
   * Exercise delete
   */
  export type ExerciseDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Exercise
     */
    select?: ExerciseSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ExerciseInclude<ExtArgs> | null
    /**
     * Filter which Exercise to delete.
     */
    where: ExerciseWhereUniqueInput
  }

  /**
   * Exercise deleteMany
   */
  export type ExerciseDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Exercises to delete
     */
    where?: ExerciseWhereInput
  }

  /**
   * Exercise.workoutExercises
   */
  export type Exercise$workoutExercisesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutExercise
     */
    select?: WorkoutExerciseSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutExerciseInclude<ExtArgs> | null
    where?: WorkoutExerciseWhereInput
    orderBy?: WorkoutExerciseOrderByWithRelationInput | WorkoutExerciseOrderByWithRelationInput[]
    cursor?: WorkoutExerciseWhereUniqueInput
    take?: number
    skip?: number
    distinct?: WorkoutExerciseScalarFieldEnum | WorkoutExerciseScalarFieldEnum[]
  }

  /**
   * Exercise.workoutProgramExercises
   */
  export type Exercise$workoutProgramExercisesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutProgramExercise
     */
    select?: WorkoutProgramExerciseSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutProgramExerciseInclude<ExtArgs> | null
    where?: WorkoutProgramExerciseWhereInput
    orderBy?: WorkoutProgramExerciseOrderByWithRelationInput | WorkoutProgramExerciseOrderByWithRelationInput[]
    cursor?: WorkoutProgramExerciseWhereUniqueInput
    take?: number
    skip?: number
    distinct?: WorkoutProgramExerciseScalarFieldEnum | WorkoutProgramExerciseScalarFieldEnum[]
  }

  /**
   * Exercise without action
   */
  export type ExerciseDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Exercise
     */
    select?: ExerciseSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ExerciseInclude<ExtArgs> | null
  }


  /**
   * Model Workout
   */

  export type AggregateWorkout = {
    _count: WorkoutCountAggregateOutputType | null
    _avg: WorkoutAvgAggregateOutputType | null
    _sum: WorkoutSumAggregateOutputType | null
    _min: WorkoutMinAggregateOutputType | null
    _max: WorkoutMaxAggregateOutputType | null
  }

  export type WorkoutAvgAggregateOutputType = {
    duration: number | null
  }

  export type WorkoutSumAggregateOutputType = {
    duration: number | null
  }

  export type WorkoutMinAggregateOutputType = {
    id: string | null
    userId: string | null
    name: string | null
    description: string | null
    date: Date | null
    duration: number | null
    notes: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type WorkoutMaxAggregateOutputType = {
    id: string | null
    userId: string | null
    name: string | null
    description: string | null
    date: Date | null
    duration: number | null
    notes: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type WorkoutCountAggregateOutputType = {
    id: number
    userId: number
    name: number
    description: number
    date: number
    duration: number
    notes: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type WorkoutAvgAggregateInputType = {
    duration?: true
  }

  export type WorkoutSumAggregateInputType = {
    duration?: true
  }

  export type WorkoutMinAggregateInputType = {
    id?: true
    userId?: true
    name?: true
    description?: true
    date?: true
    duration?: true
    notes?: true
    createdAt?: true
    updatedAt?: true
  }

  export type WorkoutMaxAggregateInputType = {
    id?: true
    userId?: true
    name?: true
    description?: true
    date?: true
    duration?: true
    notes?: true
    createdAt?: true
    updatedAt?: true
  }

  export type WorkoutCountAggregateInputType = {
    id?: true
    userId?: true
    name?: true
    description?: true
    date?: true
    duration?: true
    notes?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type WorkoutAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Workout to aggregate.
     */
    where?: WorkoutWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Workouts to fetch.
     */
    orderBy?: WorkoutOrderByWithRelationInput | WorkoutOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: WorkoutWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Workouts from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Workouts.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Workouts
    **/
    _count?: true | WorkoutCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: WorkoutAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: WorkoutSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: WorkoutMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: WorkoutMaxAggregateInputType
  }

  export type GetWorkoutAggregateType<T extends WorkoutAggregateArgs> = {
        [P in keyof T & keyof AggregateWorkout]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateWorkout[P]>
      : GetScalarType<T[P], AggregateWorkout[P]>
  }




  export type WorkoutGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: WorkoutWhereInput
    orderBy?: WorkoutOrderByWithAggregationInput | WorkoutOrderByWithAggregationInput[]
    by: WorkoutScalarFieldEnum[] | WorkoutScalarFieldEnum
    having?: WorkoutScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: WorkoutCountAggregateInputType | true
    _avg?: WorkoutAvgAggregateInputType
    _sum?: WorkoutSumAggregateInputType
    _min?: WorkoutMinAggregateInputType
    _max?: WorkoutMaxAggregateInputType
  }

  export type WorkoutGroupByOutputType = {
    id: string
    userId: string
    name: string
    description: string | null
    date: Date
    duration: number | null
    notes: string | null
    createdAt: Date
    updatedAt: Date
    _count: WorkoutCountAggregateOutputType | null
    _avg: WorkoutAvgAggregateOutputType | null
    _sum: WorkoutSumAggregateOutputType | null
    _min: WorkoutMinAggregateOutputType | null
    _max: WorkoutMaxAggregateOutputType | null
  }

  type GetWorkoutGroupByPayload<T extends WorkoutGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<WorkoutGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof WorkoutGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], WorkoutGroupByOutputType[P]>
            : GetScalarType<T[P], WorkoutGroupByOutputType[P]>
        }
      >
    >


  export type WorkoutSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    userId?: boolean
    name?: boolean
    description?: boolean
    date?: boolean
    duration?: boolean
    notes?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    exercises?: boolean | Workout$exercisesArgs<ExtArgs>
    schedules?: boolean | Workout$schedulesArgs<ExtArgs>
    _count?: boolean | WorkoutCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["workout"]>

  export type WorkoutSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    userId?: boolean
    name?: boolean
    description?: boolean
    date?: boolean
    duration?: boolean
    notes?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["workout"]>

  export type WorkoutSelectScalar = {
    id?: boolean
    userId?: boolean
    name?: boolean
    description?: boolean
    date?: boolean
    duration?: boolean
    notes?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type WorkoutInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    exercises?: boolean | Workout$exercisesArgs<ExtArgs>
    schedules?: boolean | Workout$schedulesArgs<ExtArgs>
    _count?: boolean | WorkoutCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type WorkoutIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {}

  export type $WorkoutPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "Workout"
    objects: {
      exercises: Prisma.$WorkoutExercisePayload<ExtArgs>[]
      schedules: Prisma.$WorkoutSchedulePayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      userId: string
      name: string
      description: string | null
      date: Date
      duration: number | null
      notes: string | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["workout"]>
    composites: {}
  }

  type WorkoutGetPayload<S extends boolean | null | undefined | WorkoutDefaultArgs> = $Result.GetResult<Prisma.$WorkoutPayload, S>

  type WorkoutCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<WorkoutFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: WorkoutCountAggregateInputType | true
    }

  export interface WorkoutDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['Workout'], meta: { name: 'Workout' } }
    /**
     * Find zero or one Workout that matches the filter.
     * @param {WorkoutFindUniqueArgs} args - Arguments to find a Workout
     * @example
     * // Get one Workout
     * const workout = await prisma.workout.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends WorkoutFindUniqueArgs>(args: SelectSubset<T, WorkoutFindUniqueArgs<ExtArgs>>): Prisma__WorkoutClient<$Result.GetResult<Prisma.$WorkoutPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one Workout that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {WorkoutFindUniqueOrThrowArgs} args - Arguments to find a Workout
     * @example
     * // Get one Workout
     * const workout = await prisma.workout.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends WorkoutFindUniqueOrThrowArgs>(args: SelectSubset<T, WorkoutFindUniqueOrThrowArgs<ExtArgs>>): Prisma__WorkoutClient<$Result.GetResult<Prisma.$WorkoutPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first Workout that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutFindFirstArgs} args - Arguments to find a Workout
     * @example
     * // Get one Workout
     * const workout = await prisma.workout.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends WorkoutFindFirstArgs>(args?: SelectSubset<T, WorkoutFindFirstArgs<ExtArgs>>): Prisma__WorkoutClient<$Result.GetResult<Prisma.$WorkoutPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first Workout that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutFindFirstOrThrowArgs} args - Arguments to find a Workout
     * @example
     * // Get one Workout
     * const workout = await prisma.workout.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends WorkoutFindFirstOrThrowArgs>(args?: SelectSubset<T, WorkoutFindFirstOrThrowArgs<ExtArgs>>): Prisma__WorkoutClient<$Result.GetResult<Prisma.$WorkoutPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more Workouts that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Workouts
     * const workouts = await prisma.workout.findMany()
     * 
     * // Get first 10 Workouts
     * const workouts = await prisma.workout.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const workoutWithIdOnly = await prisma.workout.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends WorkoutFindManyArgs>(args?: SelectSubset<T, WorkoutFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$WorkoutPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a Workout.
     * @param {WorkoutCreateArgs} args - Arguments to create a Workout.
     * @example
     * // Create one Workout
     * const Workout = await prisma.workout.create({
     *   data: {
     *     // ... data to create a Workout
     *   }
     * })
     * 
     */
    create<T extends WorkoutCreateArgs>(args: SelectSubset<T, WorkoutCreateArgs<ExtArgs>>): Prisma__WorkoutClient<$Result.GetResult<Prisma.$WorkoutPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many Workouts.
     * @param {WorkoutCreateManyArgs} args - Arguments to create many Workouts.
     * @example
     * // Create many Workouts
     * const workout = await prisma.workout.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends WorkoutCreateManyArgs>(args?: SelectSubset<T, WorkoutCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Workouts and returns the data saved in the database.
     * @param {WorkoutCreateManyAndReturnArgs} args - Arguments to create many Workouts.
     * @example
     * // Create many Workouts
     * const workout = await prisma.workout.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Workouts and only return the `id`
     * const workoutWithIdOnly = await prisma.workout.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends WorkoutCreateManyAndReturnArgs>(args?: SelectSubset<T, WorkoutCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$WorkoutPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a Workout.
     * @param {WorkoutDeleteArgs} args - Arguments to delete one Workout.
     * @example
     * // Delete one Workout
     * const Workout = await prisma.workout.delete({
     *   where: {
     *     // ... filter to delete one Workout
     *   }
     * })
     * 
     */
    delete<T extends WorkoutDeleteArgs>(args: SelectSubset<T, WorkoutDeleteArgs<ExtArgs>>): Prisma__WorkoutClient<$Result.GetResult<Prisma.$WorkoutPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one Workout.
     * @param {WorkoutUpdateArgs} args - Arguments to update one Workout.
     * @example
     * // Update one Workout
     * const workout = await prisma.workout.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends WorkoutUpdateArgs>(args: SelectSubset<T, WorkoutUpdateArgs<ExtArgs>>): Prisma__WorkoutClient<$Result.GetResult<Prisma.$WorkoutPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more Workouts.
     * @param {WorkoutDeleteManyArgs} args - Arguments to filter Workouts to delete.
     * @example
     * // Delete a few Workouts
     * const { count } = await prisma.workout.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends WorkoutDeleteManyArgs>(args?: SelectSubset<T, WorkoutDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Workouts.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Workouts
     * const workout = await prisma.workout.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends WorkoutUpdateManyArgs>(args: SelectSubset<T, WorkoutUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one Workout.
     * @param {WorkoutUpsertArgs} args - Arguments to update or create a Workout.
     * @example
     * // Update or create a Workout
     * const workout = await prisma.workout.upsert({
     *   create: {
     *     // ... data to create a Workout
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Workout we want to update
     *   }
     * })
     */
    upsert<T extends WorkoutUpsertArgs>(args: SelectSubset<T, WorkoutUpsertArgs<ExtArgs>>): Prisma__WorkoutClient<$Result.GetResult<Prisma.$WorkoutPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of Workouts.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutCountArgs} args - Arguments to filter Workouts to count.
     * @example
     * // Count the number of Workouts
     * const count = await prisma.workout.count({
     *   where: {
     *     // ... the filter for the Workouts we want to count
     *   }
     * })
    **/
    count<T extends WorkoutCountArgs>(
      args?: Subset<T, WorkoutCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], WorkoutCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Workout.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends WorkoutAggregateArgs>(args: Subset<T, WorkoutAggregateArgs>): Prisma.PrismaPromise<GetWorkoutAggregateType<T>>

    /**
     * Group by Workout.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutGroupByArgs} args - Group by arguments.
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
      T extends WorkoutGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: WorkoutGroupByArgs['orderBy'] }
        : { orderBy?: WorkoutGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, WorkoutGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetWorkoutGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the Workout model
   */
  readonly fields: WorkoutFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for Workout.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__WorkoutClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    exercises<T extends Workout$exercisesArgs<ExtArgs> = {}>(args?: Subset<T, Workout$exercisesArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$WorkoutExercisePayload<ExtArgs>, T, "findMany"> | Null>
    schedules<T extends Workout$schedulesArgs<ExtArgs> = {}>(args?: Subset<T, Workout$schedulesArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$WorkoutSchedulePayload<ExtArgs>, T, "findMany"> | Null>
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
   * Fields of the Workout model
   */ 
  interface WorkoutFieldRefs {
    readonly id: FieldRef<"Workout", 'String'>
    readonly userId: FieldRef<"Workout", 'String'>
    readonly name: FieldRef<"Workout", 'String'>
    readonly description: FieldRef<"Workout", 'String'>
    readonly date: FieldRef<"Workout", 'DateTime'>
    readonly duration: FieldRef<"Workout", 'Int'>
    readonly notes: FieldRef<"Workout", 'String'>
    readonly createdAt: FieldRef<"Workout", 'DateTime'>
    readonly updatedAt: FieldRef<"Workout", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * Workout findUnique
   */
  export type WorkoutFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Workout
     */
    select?: WorkoutSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutInclude<ExtArgs> | null
    /**
     * Filter, which Workout to fetch.
     */
    where: WorkoutWhereUniqueInput
  }

  /**
   * Workout findUniqueOrThrow
   */
  export type WorkoutFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Workout
     */
    select?: WorkoutSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutInclude<ExtArgs> | null
    /**
     * Filter, which Workout to fetch.
     */
    where: WorkoutWhereUniqueInput
  }

  /**
   * Workout findFirst
   */
  export type WorkoutFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Workout
     */
    select?: WorkoutSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutInclude<ExtArgs> | null
    /**
     * Filter, which Workout to fetch.
     */
    where?: WorkoutWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Workouts to fetch.
     */
    orderBy?: WorkoutOrderByWithRelationInput | WorkoutOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Workouts.
     */
    cursor?: WorkoutWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Workouts from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Workouts.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Workouts.
     */
    distinct?: WorkoutScalarFieldEnum | WorkoutScalarFieldEnum[]
  }

  /**
   * Workout findFirstOrThrow
   */
  export type WorkoutFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Workout
     */
    select?: WorkoutSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutInclude<ExtArgs> | null
    /**
     * Filter, which Workout to fetch.
     */
    where?: WorkoutWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Workouts to fetch.
     */
    orderBy?: WorkoutOrderByWithRelationInput | WorkoutOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Workouts.
     */
    cursor?: WorkoutWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Workouts from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Workouts.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Workouts.
     */
    distinct?: WorkoutScalarFieldEnum | WorkoutScalarFieldEnum[]
  }

  /**
   * Workout findMany
   */
  export type WorkoutFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Workout
     */
    select?: WorkoutSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutInclude<ExtArgs> | null
    /**
     * Filter, which Workouts to fetch.
     */
    where?: WorkoutWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Workouts to fetch.
     */
    orderBy?: WorkoutOrderByWithRelationInput | WorkoutOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Workouts.
     */
    cursor?: WorkoutWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Workouts from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Workouts.
     */
    skip?: number
    distinct?: WorkoutScalarFieldEnum | WorkoutScalarFieldEnum[]
  }

  /**
   * Workout create
   */
  export type WorkoutCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Workout
     */
    select?: WorkoutSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutInclude<ExtArgs> | null
    /**
     * The data needed to create a Workout.
     */
    data: XOR<WorkoutCreateInput, WorkoutUncheckedCreateInput>
  }

  /**
   * Workout createMany
   */
  export type WorkoutCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Workouts.
     */
    data: WorkoutCreateManyInput | WorkoutCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Workout createManyAndReturn
   */
  export type WorkoutCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Workout
     */
    select?: WorkoutSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many Workouts.
     */
    data: WorkoutCreateManyInput | WorkoutCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Workout update
   */
  export type WorkoutUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Workout
     */
    select?: WorkoutSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutInclude<ExtArgs> | null
    /**
     * The data needed to update a Workout.
     */
    data: XOR<WorkoutUpdateInput, WorkoutUncheckedUpdateInput>
    /**
     * Choose, which Workout to update.
     */
    where: WorkoutWhereUniqueInput
  }

  /**
   * Workout updateMany
   */
  export type WorkoutUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Workouts.
     */
    data: XOR<WorkoutUpdateManyMutationInput, WorkoutUncheckedUpdateManyInput>
    /**
     * Filter which Workouts to update
     */
    where?: WorkoutWhereInput
  }

  /**
   * Workout upsert
   */
  export type WorkoutUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Workout
     */
    select?: WorkoutSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutInclude<ExtArgs> | null
    /**
     * The filter to search for the Workout to update in case it exists.
     */
    where: WorkoutWhereUniqueInput
    /**
     * In case the Workout found by the `where` argument doesn't exist, create a new Workout with this data.
     */
    create: XOR<WorkoutCreateInput, WorkoutUncheckedCreateInput>
    /**
     * In case the Workout was found with the provided `where` argument, update it with this data.
     */
    update: XOR<WorkoutUpdateInput, WorkoutUncheckedUpdateInput>
  }

  /**
   * Workout delete
   */
  export type WorkoutDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Workout
     */
    select?: WorkoutSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutInclude<ExtArgs> | null
    /**
     * Filter which Workout to delete.
     */
    where: WorkoutWhereUniqueInput
  }

  /**
   * Workout deleteMany
   */
  export type WorkoutDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Workouts to delete
     */
    where?: WorkoutWhereInput
  }

  /**
   * Workout.exercises
   */
  export type Workout$exercisesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutExercise
     */
    select?: WorkoutExerciseSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutExerciseInclude<ExtArgs> | null
    where?: WorkoutExerciseWhereInput
    orderBy?: WorkoutExerciseOrderByWithRelationInput | WorkoutExerciseOrderByWithRelationInput[]
    cursor?: WorkoutExerciseWhereUniqueInput
    take?: number
    skip?: number
    distinct?: WorkoutExerciseScalarFieldEnum | WorkoutExerciseScalarFieldEnum[]
  }

  /**
   * Workout.schedules
   */
  export type Workout$schedulesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutSchedule
     */
    select?: WorkoutScheduleSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutScheduleInclude<ExtArgs> | null
    where?: WorkoutScheduleWhereInput
    orderBy?: WorkoutScheduleOrderByWithRelationInput | WorkoutScheduleOrderByWithRelationInput[]
    cursor?: WorkoutScheduleWhereUniqueInput
    take?: number
    skip?: number
    distinct?: WorkoutScheduleScalarFieldEnum | WorkoutScheduleScalarFieldEnum[]
  }

  /**
   * Workout without action
   */
  export type WorkoutDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Workout
     */
    select?: WorkoutSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutInclude<ExtArgs> | null
  }


  /**
   * Model WorkoutExercise
   */

  export type AggregateWorkoutExercise = {
    _count: WorkoutExerciseCountAggregateOutputType | null
    _avg: WorkoutExerciseAvgAggregateOutputType | null
    _sum: WorkoutExerciseSumAggregateOutputType | null
    _min: WorkoutExerciseMinAggregateOutputType | null
    _max: WorkoutExerciseMaxAggregateOutputType | null
  }

  export type WorkoutExerciseAvgAggregateOutputType = {
    sets: number | null
    reps: number | null
    duration: number | null
    weight: number | null
    order: number | null
  }

  export type WorkoutExerciseSumAggregateOutputType = {
    sets: number | null
    reps: number | null
    duration: number | null
    weight: number | null
    order: number | null
  }

  export type WorkoutExerciseMinAggregateOutputType = {
    id: string | null
    workoutId: string | null
    exerciseId: string | null
    sets: number | null
    reps: number | null
    duration: number | null
    weight: number | null
    notes: string | null
    order: number | null
    createdAt: Date | null
  }

  export type WorkoutExerciseMaxAggregateOutputType = {
    id: string | null
    workoutId: string | null
    exerciseId: string | null
    sets: number | null
    reps: number | null
    duration: number | null
    weight: number | null
    notes: string | null
    order: number | null
    createdAt: Date | null
  }

  export type WorkoutExerciseCountAggregateOutputType = {
    id: number
    workoutId: number
    exerciseId: number
    sets: number
    reps: number
    duration: number
    weight: number
    notes: number
    order: number
    createdAt: number
    _all: number
  }


  export type WorkoutExerciseAvgAggregateInputType = {
    sets?: true
    reps?: true
    duration?: true
    weight?: true
    order?: true
  }

  export type WorkoutExerciseSumAggregateInputType = {
    sets?: true
    reps?: true
    duration?: true
    weight?: true
    order?: true
  }

  export type WorkoutExerciseMinAggregateInputType = {
    id?: true
    workoutId?: true
    exerciseId?: true
    sets?: true
    reps?: true
    duration?: true
    weight?: true
    notes?: true
    order?: true
    createdAt?: true
  }

  export type WorkoutExerciseMaxAggregateInputType = {
    id?: true
    workoutId?: true
    exerciseId?: true
    sets?: true
    reps?: true
    duration?: true
    weight?: true
    notes?: true
    order?: true
    createdAt?: true
  }

  export type WorkoutExerciseCountAggregateInputType = {
    id?: true
    workoutId?: true
    exerciseId?: true
    sets?: true
    reps?: true
    duration?: true
    weight?: true
    notes?: true
    order?: true
    createdAt?: true
    _all?: true
  }

  export type WorkoutExerciseAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which WorkoutExercise to aggregate.
     */
    where?: WorkoutExerciseWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of WorkoutExercises to fetch.
     */
    orderBy?: WorkoutExerciseOrderByWithRelationInput | WorkoutExerciseOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: WorkoutExerciseWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` WorkoutExercises from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` WorkoutExercises.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned WorkoutExercises
    **/
    _count?: true | WorkoutExerciseCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: WorkoutExerciseAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: WorkoutExerciseSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: WorkoutExerciseMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: WorkoutExerciseMaxAggregateInputType
  }

  export type GetWorkoutExerciseAggregateType<T extends WorkoutExerciseAggregateArgs> = {
        [P in keyof T & keyof AggregateWorkoutExercise]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateWorkoutExercise[P]>
      : GetScalarType<T[P], AggregateWorkoutExercise[P]>
  }




  export type WorkoutExerciseGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: WorkoutExerciseWhereInput
    orderBy?: WorkoutExerciseOrderByWithAggregationInput | WorkoutExerciseOrderByWithAggregationInput[]
    by: WorkoutExerciseScalarFieldEnum[] | WorkoutExerciseScalarFieldEnum
    having?: WorkoutExerciseScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: WorkoutExerciseCountAggregateInputType | true
    _avg?: WorkoutExerciseAvgAggregateInputType
    _sum?: WorkoutExerciseSumAggregateInputType
    _min?: WorkoutExerciseMinAggregateInputType
    _max?: WorkoutExerciseMaxAggregateInputType
  }

  export type WorkoutExerciseGroupByOutputType = {
    id: string
    workoutId: string
    exerciseId: string
    sets: number
    reps: number | null
    duration: number | null
    weight: number | null
    notes: string | null
    order: number
    createdAt: Date
    _count: WorkoutExerciseCountAggregateOutputType | null
    _avg: WorkoutExerciseAvgAggregateOutputType | null
    _sum: WorkoutExerciseSumAggregateOutputType | null
    _min: WorkoutExerciseMinAggregateOutputType | null
    _max: WorkoutExerciseMaxAggregateOutputType | null
  }

  type GetWorkoutExerciseGroupByPayload<T extends WorkoutExerciseGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<WorkoutExerciseGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof WorkoutExerciseGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], WorkoutExerciseGroupByOutputType[P]>
            : GetScalarType<T[P], WorkoutExerciseGroupByOutputType[P]>
        }
      >
    >


  export type WorkoutExerciseSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    workoutId?: boolean
    exerciseId?: boolean
    sets?: boolean
    reps?: boolean
    duration?: boolean
    weight?: boolean
    notes?: boolean
    order?: boolean
    createdAt?: boolean
    workout?: boolean | WorkoutDefaultArgs<ExtArgs>
    exercise?: boolean | ExerciseDefaultArgs<ExtArgs>
    workoutSets?: boolean | WorkoutExercise$workoutSetsArgs<ExtArgs>
    _count?: boolean | WorkoutExerciseCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["workoutExercise"]>

  export type WorkoutExerciseSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    workoutId?: boolean
    exerciseId?: boolean
    sets?: boolean
    reps?: boolean
    duration?: boolean
    weight?: boolean
    notes?: boolean
    order?: boolean
    createdAt?: boolean
    workout?: boolean | WorkoutDefaultArgs<ExtArgs>
    exercise?: boolean | ExerciseDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["workoutExercise"]>

  export type WorkoutExerciseSelectScalar = {
    id?: boolean
    workoutId?: boolean
    exerciseId?: boolean
    sets?: boolean
    reps?: boolean
    duration?: boolean
    weight?: boolean
    notes?: boolean
    order?: boolean
    createdAt?: boolean
  }

  export type WorkoutExerciseInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    workout?: boolean | WorkoutDefaultArgs<ExtArgs>
    exercise?: boolean | ExerciseDefaultArgs<ExtArgs>
    workoutSets?: boolean | WorkoutExercise$workoutSetsArgs<ExtArgs>
    _count?: boolean | WorkoutExerciseCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type WorkoutExerciseIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    workout?: boolean | WorkoutDefaultArgs<ExtArgs>
    exercise?: boolean | ExerciseDefaultArgs<ExtArgs>
  }

  export type $WorkoutExercisePayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "WorkoutExercise"
    objects: {
      workout: Prisma.$WorkoutPayload<ExtArgs>
      exercise: Prisma.$ExercisePayload<ExtArgs>
      workoutSets: Prisma.$WorkoutSetPayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      workoutId: string
      exerciseId: string
      sets: number
      reps: number | null
      duration: number | null
      weight: number | null
      notes: string | null
      order: number
      createdAt: Date
    }, ExtArgs["result"]["workoutExercise"]>
    composites: {}
  }

  type WorkoutExerciseGetPayload<S extends boolean | null | undefined | WorkoutExerciseDefaultArgs> = $Result.GetResult<Prisma.$WorkoutExercisePayload, S>

  type WorkoutExerciseCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<WorkoutExerciseFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: WorkoutExerciseCountAggregateInputType | true
    }

  export interface WorkoutExerciseDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['WorkoutExercise'], meta: { name: 'WorkoutExercise' } }
    /**
     * Find zero or one WorkoutExercise that matches the filter.
     * @param {WorkoutExerciseFindUniqueArgs} args - Arguments to find a WorkoutExercise
     * @example
     * // Get one WorkoutExercise
     * const workoutExercise = await prisma.workoutExercise.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends WorkoutExerciseFindUniqueArgs>(args: SelectSubset<T, WorkoutExerciseFindUniqueArgs<ExtArgs>>): Prisma__WorkoutExerciseClient<$Result.GetResult<Prisma.$WorkoutExercisePayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one WorkoutExercise that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {WorkoutExerciseFindUniqueOrThrowArgs} args - Arguments to find a WorkoutExercise
     * @example
     * // Get one WorkoutExercise
     * const workoutExercise = await prisma.workoutExercise.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends WorkoutExerciseFindUniqueOrThrowArgs>(args: SelectSubset<T, WorkoutExerciseFindUniqueOrThrowArgs<ExtArgs>>): Prisma__WorkoutExerciseClient<$Result.GetResult<Prisma.$WorkoutExercisePayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first WorkoutExercise that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutExerciseFindFirstArgs} args - Arguments to find a WorkoutExercise
     * @example
     * // Get one WorkoutExercise
     * const workoutExercise = await prisma.workoutExercise.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends WorkoutExerciseFindFirstArgs>(args?: SelectSubset<T, WorkoutExerciseFindFirstArgs<ExtArgs>>): Prisma__WorkoutExerciseClient<$Result.GetResult<Prisma.$WorkoutExercisePayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first WorkoutExercise that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutExerciseFindFirstOrThrowArgs} args - Arguments to find a WorkoutExercise
     * @example
     * // Get one WorkoutExercise
     * const workoutExercise = await prisma.workoutExercise.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends WorkoutExerciseFindFirstOrThrowArgs>(args?: SelectSubset<T, WorkoutExerciseFindFirstOrThrowArgs<ExtArgs>>): Prisma__WorkoutExerciseClient<$Result.GetResult<Prisma.$WorkoutExercisePayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more WorkoutExercises that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutExerciseFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all WorkoutExercises
     * const workoutExercises = await prisma.workoutExercise.findMany()
     * 
     * // Get first 10 WorkoutExercises
     * const workoutExercises = await prisma.workoutExercise.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const workoutExerciseWithIdOnly = await prisma.workoutExercise.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends WorkoutExerciseFindManyArgs>(args?: SelectSubset<T, WorkoutExerciseFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$WorkoutExercisePayload<ExtArgs>, T, "findMany">>

    /**
     * Create a WorkoutExercise.
     * @param {WorkoutExerciseCreateArgs} args - Arguments to create a WorkoutExercise.
     * @example
     * // Create one WorkoutExercise
     * const WorkoutExercise = await prisma.workoutExercise.create({
     *   data: {
     *     // ... data to create a WorkoutExercise
     *   }
     * })
     * 
     */
    create<T extends WorkoutExerciseCreateArgs>(args: SelectSubset<T, WorkoutExerciseCreateArgs<ExtArgs>>): Prisma__WorkoutExerciseClient<$Result.GetResult<Prisma.$WorkoutExercisePayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many WorkoutExercises.
     * @param {WorkoutExerciseCreateManyArgs} args - Arguments to create many WorkoutExercises.
     * @example
     * // Create many WorkoutExercises
     * const workoutExercise = await prisma.workoutExercise.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends WorkoutExerciseCreateManyArgs>(args?: SelectSubset<T, WorkoutExerciseCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many WorkoutExercises and returns the data saved in the database.
     * @param {WorkoutExerciseCreateManyAndReturnArgs} args - Arguments to create many WorkoutExercises.
     * @example
     * // Create many WorkoutExercises
     * const workoutExercise = await prisma.workoutExercise.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many WorkoutExercises and only return the `id`
     * const workoutExerciseWithIdOnly = await prisma.workoutExercise.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends WorkoutExerciseCreateManyAndReturnArgs>(args?: SelectSubset<T, WorkoutExerciseCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$WorkoutExercisePayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a WorkoutExercise.
     * @param {WorkoutExerciseDeleteArgs} args - Arguments to delete one WorkoutExercise.
     * @example
     * // Delete one WorkoutExercise
     * const WorkoutExercise = await prisma.workoutExercise.delete({
     *   where: {
     *     // ... filter to delete one WorkoutExercise
     *   }
     * })
     * 
     */
    delete<T extends WorkoutExerciseDeleteArgs>(args: SelectSubset<T, WorkoutExerciseDeleteArgs<ExtArgs>>): Prisma__WorkoutExerciseClient<$Result.GetResult<Prisma.$WorkoutExercisePayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one WorkoutExercise.
     * @param {WorkoutExerciseUpdateArgs} args - Arguments to update one WorkoutExercise.
     * @example
     * // Update one WorkoutExercise
     * const workoutExercise = await prisma.workoutExercise.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends WorkoutExerciseUpdateArgs>(args: SelectSubset<T, WorkoutExerciseUpdateArgs<ExtArgs>>): Prisma__WorkoutExerciseClient<$Result.GetResult<Prisma.$WorkoutExercisePayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more WorkoutExercises.
     * @param {WorkoutExerciseDeleteManyArgs} args - Arguments to filter WorkoutExercises to delete.
     * @example
     * // Delete a few WorkoutExercises
     * const { count } = await prisma.workoutExercise.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends WorkoutExerciseDeleteManyArgs>(args?: SelectSubset<T, WorkoutExerciseDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more WorkoutExercises.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutExerciseUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many WorkoutExercises
     * const workoutExercise = await prisma.workoutExercise.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends WorkoutExerciseUpdateManyArgs>(args: SelectSubset<T, WorkoutExerciseUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one WorkoutExercise.
     * @param {WorkoutExerciseUpsertArgs} args - Arguments to update or create a WorkoutExercise.
     * @example
     * // Update or create a WorkoutExercise
     * const workoutExercise = await prisma.workoutExercise.upsert({
     *   create: {
     *     // ... data to create a WorkoutExercise
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the WorkoutExercise we want to update
     *   }
     * })
     */
    upsert<T extends WorkoutExerciseUpsertArgs>(args: SelectSubset<T, WorkoutExerciseUpsertArgs<ExtArgs>>): Prisma__WorkoutExerciseClient<$Result.GetResult<Prisma.$WorkoutExercisePayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of WorkoutExercises.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutExerciseCountArgs} args - Arguments to filter WorkoutExercises to count.
     * @example
     * // Count the number of WorkoutExercises
     * const count = await prisma.workoutExercise.count({
     *   where: {
     *     // ... the filter for the WorkoutExercises we want to count
     *   }
     * })
    **/
    count<T extends WorkoutExerciseCountArgs>(
      args?: Subset<T, WorkoutExerciseCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], WorkoutExerciseCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a WorkoutExercise.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutExerciseAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends WorkoutExerciseAggregateArgs>(args: Subset<T, WorkoutExerciseAggregateArgs>): Prisma.PrismaPromise<GetWorkoutExerciseAggregateType<T>>

    /**
     * Group by WorkoutExercise.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutExerciseGroupByArgs} args - Group by arguments.
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
      T extends WorkoutExerciseGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: WorkoutExerciseGroupByArgs['orderBy'] }
        : { orderBy?: WorkoutExerciseGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, WorkoutExerciseGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetWorkoutExerciseGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the WorkoutExercise model
   */
  readonly fields: WorkoutExerciseFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for WorkoutExercise.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__WorkoutExerciseClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    workout<T extends WorkoutDefaultArgs<ExtArgs> = {}>(args?: Subset<T, WorkoutDefaultArgs<ExtArgs>>): Prisma__WorkoutClient<$Result.GetResult<Prisma.$WorkoutPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
    exercise<T extends ExerciseDefaultArgs<ExtArgs> = {}>(args?: Subset<T, ExerciseDefaultArgs<ExtArgs>>): Prisma__ExerciseClient<$Result.GetResult<Prisma.$ExercisePayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
    workoutSets<T extends WorkoutExercise$workoutSetsArgs<ExtArgs> = {}>(args?: Subset<T, WorkoutExercise$workoutSetsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$WorkoutSetPayload<ExtArgs>, T, "findMany"> | Null>
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
   * Fields of the WorkoutExercise model
   */ 
  interface WorkoutExerciseFieldRefs {
    readonly id: FieldRef<"WorkoutExercise", 'String'>
    readonly workoutId: FieldRef<"WorkoutExercise", 'String'>
    readonly exerciseId: FieldRef<"WorkoutExercise", 'String'>
    readonly sets: FieldRef<"WorkoutExercise", 'Int'>
    readonly reps: FieldRef<"WorkoutExercise", 'Int'>
    readonly duration: FieldRef<"WorkoutExercise", 'Int'>
    readonly weight: FieldRef<"WorkoutExercise", 'Float'>
    readonly notes: FieldRef<"WorkoutExercise", 'String'>
    readonly order: FieldRef<"WorkoutExercise", 'Int'>
    readonly createdAt: FieldRef<"WorkoutExercise", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * WorkoutExercise findUnique
   */
  export type WorkoutExerciseFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutExercise
     */
    select?: WorkoutExerciseSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutExerciseInclude<ExtArgs> | null
    /**
     * Filter, which WorkoutExercise to fetch.
     */
    where: WorkoutExerciseWhereUniqueInput
  }

  /**
   * WorkoutExercise findUniqueOrThrow
   */
  export type WorkoutExerciseFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutExercise
     */
    select?: WorkoutExerciseSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutExerciseInclude<ExtArgs> | null
    /**
     * Filter, which WorkoutExercise to fetch.
     */
    where: WorkoutExerciseWhereUniqueInput
  }

  /**
   * WorkoutExercise findFirst
   */
  export type WorkoutExerciseFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutExercise
     */
    select?: WorkoutExerciseSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutExerciseInclude<ExtArgs> | null
    /**
     * Filter, which WorkoutExercise to fetch.
     */
    where?: WorkoutExerciseWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of WorkoutExercises to fetch.
     */
    orderBy?: WorkoutExerciseOrderByWithRelationInput | WorkoutExerciseOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for WorkoutExercises.
     */
    cursor?: WorkoutExerciseWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` WorkoutExercises from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` WorkoutExercises.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of WorkoutExercises.
     */
    distinct?: WorkoutExerciseScalarFieldEnum | WorkoutExerciseScalarFieldEnum[]
  }

  /**
   * WorkoutExercise findFirstOrThrow
   */
  export type WorkoutExerciseFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutExercise
     */
    select?: WorkoutExerciseSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutExerciseInclude<ExtArgs> | null
    /**
     * Filter, which WorkoutExercise to fetch.
     */
    where?: WorkoutExerciseWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of WorkoutExercises to fetch.
     */
    orderBy?: WorkoutExerciseOrderByWithRelationInput | WorkoutExerciseOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for WorkoutExercises.
     */
    cursor?: WorkoutExerciseWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` WorkoutExercises from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` WorkoutExercises.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of WorkoutExercises.
     */
    distinct?: WorkoutExerciseScalarFieldEnum | WorkoutExerciseScalarFieldEnum[]
  }

  /**
   * WorkoutExercise findMany
   */
  export type WorkoutExerciseFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutExercise
     */
    select?: WorkoutExerciseSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutExerciseInclude<ExtArgs> | null
    /**
     * Filter, which WorkoutExercises to fetch.
     */
    where?: WorkoutExerciseWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of WorkoutExercises to fetch.
     */
    orderBy?: WorkoutExerciseOrderByWithRelationInput | WorkoutExerciseOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing WorkoutExercises.
     */
    cursor?: WorkoutExerciseWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` WorkoutExercises from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` WorkoutExercises.
     */
    skip?: number
    distinct?: WorkoutExerciseScalarFieldEnum | WorkoutExerciseScalarFieldEnum[]
  }

  /**
   * WorkoutExercise create
   */
  export type WorkoutExerciseCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutExercise
     */
    select?: WorkoutExerciseSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutExerciseInclude<ExtArgs> | null
    /**
     * The data needed to create a WorkoutExercise.
     */
    data: XOR<WorkoutExerciseCreateInput, WorkoutExerciseUncheckedCreateInput>
  }

  /**
   * WorkoutExercise createMany
   */
  export type WorkoutExerciseCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many WorkoutExercises.
     */
    data: WorkoutExerciseCreateManyInput | WorkoutExerciseCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * WorkoutExercise createManyAndReturn
   */
  export type WorkoutExerciseCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutExercise
     */
    select?: WorkoutExerciseSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many WorkoutExercises.
     */
    data: WorkoutExerciseCreateManyInput | WorkoutExerciseCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutExerciseIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * WorkoutExercise update
   */
  export type WorkoutExerciseUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutExercise
     */
    select?: WorkoutExerciseSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutExerciseInclude<ExtArgs> | null
    /**
     * The data needed to update a WorkoutExercise.
     */
    data: XOR<WorkoutExerciseUpdateInput, WorkoutExerciseUncheckedUpdateInput>
    /**
     * Choose, which WorkoutExercise to update.
     */
    where: WorkoutExerciseWhereUniqueInput
  }

  /**
   * WorkoutExercise updateMany
   */
  export type WorkoutExerciseUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update WorkoutExercises.
     */
    data: XOR<WorkoutExerciseUpdateManyMutationInput, WorkoutExerciseUncheckedUpdateManyInput>
    /**
     * Filter which WorkoutExercises to update
     */
    where?: WorkoutExerciseWhereInput
  }

  /**
   * WorkoutExercise upsert
   */
  export type WorkoutExerciseUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutExercise
     */
    select?: WorkoutExerciseSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutExerciseInclude<ExtArgs> | null
    /**
     * The filter to search for the WorkoutExercise to update in case it exists.
     */
    where: WorkoutExerciseWhereUniqueInput
    /**
     * In case the WorkoutExercise found by the `where` argument doesn't exist, create a new WorkoutExercise with this data.
     */
    create: XOR<WorkoutExerciseCreateInput, WorkoutExerciseUncheckedCreateInput>
    /**
     * In case the WorkoutExercise was found with the provided `where` argument, update it with this data.
     */
    update: XOR<WorkoutExerciseUpdateInput, WorkoutExerciseUncheckedUpdateInput>
  }

  /**
   * WorkoutExercise delete
   */
  export type WorkoutExerciseDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutExercise
     */
    select?: WorkoutExerciseSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutExerciseInclude<ExtArgs> | null
    /**
     * Filter which WorkoutExercise to delete.
     */
    where: WorkoutExerciseWhereUniqueInput
  }

  /**
   * WorkoutExercise deleteMany
   */
  export type WorkoutExerciseDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which WorkoutExercises to delete
     */
    where?: WorkoutExerciseWhereInput
  }

  /**
   * WorkoutExercise.workoutSets
   */
  export type WorkoutExercise$workoutSetsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutSet
     */
    select?: WorkoutSetSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutSetInclude<ExtArgs> | null
    where?: WorkoutSetWhereInput
    orderBy?: WorkoutSetOrderByWithRelationInput | WorkoutSetOrderByWithRelationInput[]
    cursor?: WorkoutSetWhereUniqueInput
    take?: number
    skip?: number
    distinct?: WorkoutSetScalarFieldEnum | WorkoutSetScalarFieldEnum[]
  }

  /**
   * WorkoutExercise without action
   */
  export type WorkoutExerciseDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutExercise
     */
    select?: WorkoutExerciseSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutExerciseInclude<ExtArgs> | null
  }


  /**
   * Model WorkoutSet
   */

  export type AggregateWorkoutSet = {
    _count: WorkoutSetCountAggregateOutputType | null
    _avg: WorkoutSetAvgAggregateOutputType | null
    _sum: WorkoutSetSumAggregateOutputType | null
    _min: WorkoutSetMinAggregateOutputType | null
    _max: WorkoutSetMaxAggregateOutputType | null
  }

  export type WorkoutSetAvgAggregateOutputType = {
    setNumber: number | null
    reps: number | null
    weight: number | null
    rpe: number | null
  }

  export type WorkoutSetSumAggregateOutputType = {
    setNumber: number | null
    reps: number | null
    weight: number | null
    rpe: number | null
  }

  export type WorkoutSetMinAggregateOutputType = {
    id: string | null
    workoutExerciseId: string | null
    setNumber: number | null
    reps: number | null
    weight: number | null
    rpe: number | null
    completed: boolean | null
    createdAt: Date | null
  }

  export type WorkoutSetMaxAggregateOutputType = {
    id: string | null
    workoutExerciseId: string | null
    setNumber: number | null
    reps: number | null
    weight: number | null
    rpe: number | null
    completed: boolean | null
    createdAt: Date | null
  }

  export type WorkoutSetCountAggregateOutputType = {
    id: number
    workoutExerciseId: number
    setNumber: number
    reps: number
    weight: number
    rpe: number
    completed: number
    createdAt: number
    _all: number
  }


  export type WorkoutSetAvgAggregateInputType = {
    setNumber?: true
    reps?: true
    weight?: true
    rpe?: true
  }

  export type WorkoutSetSumAggregateInputType = {
    setNumber?: true
    reps?: true
    weight?: true
    rpe?: true
  }

  export type WorkoutSetMinAggregateInputType = {
    id?: true
    workoutExerciseId?: true
    setNumber?: true
    reps?: true
    weight?: true
    rpe?: true
    completed?: true
    createdAt?: true
  }

  export type WorkoutSetMaxAggregateInputType = {
    id?: true
    workoutExerciseId?: true
    setNumber?: true
    reps?: true
    weight?: true
    rpe?: true
    completed?: true
    createdAt?: true
  }

  export type WorkoutSetCountAggregateInputType = {
    id?: true
    workoutExerciseId?: true
    setNumber?: true
    reps?: true
    weight?: true
    rpe?: true
    completed?: true
    createdAt?: true
    _all?: true
  }

  export type WorkoutSetAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which WorkoutSet to aggregate.
     */
    where?: WorkoutSetWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of WorkoutSets to fetch.
     */
    orderBy?: WorkoutSetOrderByWithRelationInput | WorkoutSetOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: WorkoutSetWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` WorkoutSets from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` WorkoutSets.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned WorkoutSets
    **/
    _count?: true | WorkoutSetCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: WorkoutSetAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: WorkoutSetSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: WorkoutSetMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: WorkoutSetMaxAggregateInputType
  }

  export type GetWorkoutSetAggregateType<T extends WorkoutSetAggregateArgs> = {
        [P in keyof T & keyof AggregateWorkoutSet]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateWorkoutSet[P]>
      : GetScalarType<T[P], AggregateWorkoutSet[P]>
  }




  export type WorkoutSetGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: WorkoutSetWhereInput
    orderBy?: WorkoutSetOrderByWithAggregationInput | WorkoutSetOrderByWithAggregationInput[]
    by: WorkoutSetScalarFieldEnum[] | WorkoutSetScalarFieldEnum
    having?: WorkoutSetScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: WorkoutSetCountAggregateInputType | true
    _avg?: WorkoutSetAvgAggregateInputType
    _sum?: WorkoutSetSumAggregateInputType
    _min?: WorkoutSetMinAggregateInputType
    _max?: WorkoutSetMaxAggregateInputType
  }

  export type WorkoutSetGroupByOutputType = {
    id: string
    workoutExerciseId: string
    setNumber: number
    reps: number | null
    weight: number | null
    rpe: number | null
    completed: boolean
    createdAt: Date
    _count: WorkoutSetCountAggregateOutputType | null
    _avg: WorkoutSetAvgAggregateOutputType | null
    _sum: WorkoutSetSumAggregateOutputType | null
    _min: WorkoutSetMinAggregateOutputType | null
    _max: WorkoutSetMaxAggregateOutputType | null
  }

  type GetWorkoutSetGroupByPayload<T extends WorkoutSetGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<WorkoutSetGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof WorkoutSetGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], WorkoutSetGroupByOutputType[P]>
            : GetScalarType<T[P], WorkoutSetGroupByOutputType[P]>
        }
      >
    >


  export type WorkoutSetSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    workoutExerciseId?: boolean
    setNumber?: boolean
    reps?: boolean
    weight?: boolean
    rpe?: boolean
    completed?: boolean
    createdAt?: boolean
    workoutExercise?: boolean | WorkoutExerciseDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["workoutSet"]>

  export type WorkoutSetSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    workoutExerciseId?: boolean
    setNumber?: boolean
    reps?: boolean
    weight?: boolean
    rpe?: boolean
    completed?: boolean
    createdAt?: boolean
    workoutExercise?: boolean | WorkoutExerciseDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["workoutSet"]>

  export type WorkoutSetSelectScalar = {
    id?: boolean
    workoutExerciseId?: boolean
    setNumber?: boolean
    reps?: boolean
    weight?: boolean
    rpe?: boolean
    completed?: boolean
    createdAt?: boolean
  }

  export type WorkoutSetInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    workoutExercise?: boolean | WorkoutExerciseDefaultArgs<ExtArgs>
  }
  export type WorkoutSetIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    workoutExercise?: boolean | WorkoutExerciseDefaultArgs<ExtArgs>
  }

  export type $WorkoutSetPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "WorkoutSet"
    objects: {
      workoutExercise: Prisma.$WorkoutExercisePayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      workoutExerciseId: string
      setNumber: number
      reps: number | null
      weight: number | null
      rpe: number | null
      completed: boolean
      createdAt: Date
    }, ExtArgs["result"]["workoutSet"]>
    composites: {}
  }

  type WorkoutSetGetPayload<S extends boolean | null | undefined | WorkoutSetDefaultArgs> = $Result.GetResult<Prisma.$WorkoutSetPayload, S>

  type WorkoutSetCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<WorkoutSetFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: WorkoutSetCountAggregateInputType | true
    }

  export interface WorkoutSetDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['WorkoutSet'], meta: { name: 'WorkoutSet' } }
    /**
     * Find zero or one WorkoutSet that matches the filter.
     * @param {WorkoutSetFindUniqueArgs} args - Arguments to find a WorkoutSet
     * @example
     * // Get one WorkoutSet
     * const workoutSet = await prisma.workoutSet.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends WorkoutSetFindUniqueArgs>(args: SelectSubset<T, WorkoutSetFindUniqueArgs<ExtArgs>>): Prisma__WorkoutSetClient<$Result.GetResult<Prisma.$WorkoutSetPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one WorkoutSet that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {WorkoutSetFindUniqueOrThrowArgs} args - Arguments to find a WorkoutSet
     * @example
     * // Get one WorkoutSet
     * const workoutSet = await prisma.workoutSet.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends WorkoutSetFindUniqueOrThrowArgs>(args: SelectSubset<T, WorkoutSetFindUniqueOrThrowArgs<ExtArgs>>): Prisma__WorkoutSetClient<$Result.GetResult<Prisma.$WorkoutSetPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first WorkoutSet that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutSetFindFirstArgs} args - Arguments to find a WorkoutSet
     * @example
     * // Get one WorkoutSet
     * const workoutSet = await prisma.workoutSet.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends WorkoutSetFindFirstArgs>(args?: SelectSubset<T, WorkoutSetFindFirstArgs<ExtArgs>>): Prisma__WorkoutSetClient<$Result.GetResult<Prisma.$WorkoutSetPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first WorkoutSet that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutSetFindFirstOrThrowArgs} args - Arguments to find a WorkoutSet
     * @example
     * // Get one WorkoutSet
     * const workoutSet = await prisma.workoutSet.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends WorkoutSetFindFirstOrThrowArgs>(args?: SelectSubset<T, WorkoutSetFindFirstOrThrowArgs<ExtArgs>>): Prisma__WorkoutSetClient<$Result.GetResult<Prisma.$WorkoutSetPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more WorkoutSets that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutSetFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all WorkoutSets
     * const workoutSets = await prisma.workoutSet.findMany()
     * 
     * // Get first 10 WorkoutSets
     * const workoutSets = await prisma.workoutSet.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const workoutSetWithIdOnly = await prisma.workoutSet.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends WorkoutSetFindManyArgs>(args?: SelectSubset<T, WorkoutSetFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$WorkoutSetPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a WorkoutSet.
     * @param {WorkoutSetCreateArgs} args - Arguments to create a WorkoutSet.
     * @example
     * // Create one WorkoutSet
     * const WorkoutSet = await prisma.workoutSet.create({
     *   data: {
     *     // ... data to create a WorkoutSet
     *   }
     * })
     * 
     */
    create<T extends WorkoutSetCreateArgs>(args: SelectSubset<T, WorkoutSetCreateArgs<ExtArgs>>): Prisma__WorkoutSetClient<$Result.GetResult<Prisma.$WorkoutSetPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many WorkoutSets.
     * @param {WorkoutSetCreateManyArgs} args - Arguments to create many WorkoutSets.
     * @example
     * // Create many WorkoutSets
     * const workoutSet = await prisma.workoutSet.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends WorkoutSetCreateManyArgs>(args?: SelectSubset<T, WorkoutSetCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many WorkoutSets and returns the data saved in the database.
     * @param {WorkoutSetCreateManyAndReturnArgs} args - Arguments to create many WorkoutSets.
     * @example
     * // Create many WorkoutSets
     * const workoutSet = await prisma.workoutSet.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many WorkoutSets and only return the `id`
     * const workoutSetWithIdOnly = await prisma.workoutSet.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends WorkoutSetCreateManyAndReturnArgs>(args?: SelectSubset<T, WorkoutSetCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$WorkoutSetPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a WorkoutSet.
     * @param {WorkoutSetDeleteArgs} args - Arguments to delete one WorkoutSet.
     * @example
     * // Delete one WorkoutSet
     * const WorkoutSet = await prisma.workoutSet.delete({
     *   where: {
     *     // ... filter to delete one WorkoutSet
     *   }
     * })
     * 
     */
    delete<T extends WorkoutSetDeleteArgs>(args: SelectSubset<T, WorkoutSetDeleteArgs<ExtArgs>>): Prisma__WorkoutSetClient<$Result.GetResult<Prisma.$WorkoutSetPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one WorkoutSet.
     * @param {WorkoutSetUpdateArgs} args - Arguments to update one WorkoutSet.
     * @example
     * // Update one WorkoutSet
     * const workoutSet = await prisma.workoutSet.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends WorkoutSetUpdateArgs>(args: SelectSubset<T, WorkoutSetUpdateArgs<ExtArgs>>): Prisma__WorkoutSetClient<$Result.GetResult<Prisma.$WorkoutSetPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more WorkoutSets.
     * @param {WorkoutSetDeleteManyArgs} args - Arguments to filter WorkoutSets to delete.
     * @example
     * // Delete a few WorkoutSets
     * const { count } = await prisma.workoutSet.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends WorkoutSetDeleteManyArgs>(args?: SelectSubset<T, WorkoutSetDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more WorkoutSets.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutSetUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many WorkoutSets
     * const workoutSet = await prisma.workoutSet.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends WorkoutSetUpdateManyArgs>(args: SelectSubset<T, WorkoutSetUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one WorkoutSet.
     * @param {WorkoutSetUpsertArgs} args - Arguments to update or create a WorkoutSet.
     * @example
     * // Update or create a WorkoutSet
     * const workoutSet = await prisma.workoutSet.upsert({
     *   create: {
     *     // ... data to create a WorkoutSet
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the WorkoutSet we want to update
     *   }
     * })
     */
    upsert<T extends WorkoutSetUpsertArgs>(args: SelectSubset<T, WorkoutSetUpsertArgs<ExtArgs>>): Prisma__WorkoutSetClient<$Result.GetResult<Prisma.$WorkoutSetPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of WorkoutSets.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutSetCountArgs} args - Arguments to filter WorkoutSets to count.
     * @example
     * // Count the number of WorkoutSets
     * const count = await prisma.workoutSet.count({
     *   where: {
     *     // ... the filter for the WorkoutSets we want to count
     *   }
     * })
    **/
    count<T extends WorkoutSetCountArgs>(
      args?: Subset<T, WorkoutSetCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], WorkoutSetCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a WorkoutSet.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutSetAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends WorkoutSetAggregateArgs>(args: Subset<T, WorkoutSetAggregateArgs>): Prisma.PrismaPromise<GetWorkoutSetAggregateType<T>>

    /**
     * Group by WorkoutSet.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutSetGroupByArgs} args - Group by arguments.
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
      T extends WorkoutSetGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: WorkoutSetGroupByArgs['orderBy'] }
        : { orderBy?: WorkoutSetGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, WorkoutSetGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetWorkoutSetGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the WorkoutSet model
   */
  readonly fields: WorkoutSetFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for WorkoutSet.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__WorkoutSetClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    workoutExercise<T extends WorkoutExerciseDefaultArgs<ExtArgs> = {}>(args?: Subset<T, WorkoutExerciseDefaultArgs<ExtArgs>>): Prisma__WorkoutExerciseClient<$Result.GetResult<Prisma.$WorkoutExercisePayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
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
   * Fields of the WorkoutSet model
   */ 
  interface WorkoutSetFieldRefs {
    readonly id: FieldRef<"WorkoutSet", 'String'>
    readonly workoutExerciseId: FieldRef<"WorkoutSet", 'String'>
    readonly setNumber: FieldRef<"WorkoutSet", 'Int'>
    readonly reps: FieldRef<"WorkoutSet", 'Int'>
    readonly weight: FieldRef<"WorkoutSet", 'Float'>
    readonly rpe: FieldRef<"WorkoutSet", 'Float'>
    readonly completed: FieldRef<"WorkoutSet", 'Boolean'>
    readonly createdAt: FieldRef<"WorkoutSet", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * WorkoutSet findUnique
   */
  export type WorkoutSetFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutSet
     */
    select?: WorkoutSetSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutSetInclude<ExtArgs> | null
    /**
     * Filter, which WorkoutSet to fetch.
     */
    where: WorkoutSetWhereUniqueInput
  }

  /**
   * WorkoutSet findUniqueOrThrow
   */
  export type WorkoutSetFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutSet
     */
    select?: WorkoutSetSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutSetInclude<ExtArgs> | null
    /**
     * Filter, which WorkoutSet to fetch.
     */
    where: WorkoutSetWhereUniqueInput
  }

  /**
   * WorkoutSet findFirst
   */
  export type WorkoutSetFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutSet
     */
    select?: WorkoutSetSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutSetInclude<ExtArgs> | null
    /**
     * Filter, which WorkoutSet to fetch.
     */
    where?: WorkoutSetWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of WorkoutSets to fetch.
     */
    orderBy?: WorkoutSetOrderByWithRelationInput | WorkoutSetOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for WorkoutSets.
     */
    cursor?: WorkoutSetWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` WorkoutSets from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` WorkoutSets.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of WorkoutSets.
     */
    distinct?: WorkoutSetScalarFieldEnum | WorkoutSetScalarFieldEnum[]
  }

  /**
   * WorkoutSet findFirstOrThrow
   */
  export type WorkoutSetFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutSet
     */
    select?: WorkoutSetSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutSetInclude<ExtArgs> | null
    /**
     * Filter, which WorkoutSet to fetch.
     */
    where?: WorkoutSetWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of WorkoutSets to fetch.
     */
    orderBy?: WorkoutSetOrderByWithRelationInput | WorkoutSetOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for WorkoutSets.
     */
    cursor?: WorkoutSetWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` WorkoutSets from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` WorkoutSets.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of WorkoutSets.
     */
    distinct?: WorkoutSetScalarFieldEnum | WorkoutSetScalarFieldEnum[]
  }

  /**
   * WorkoutSet findMany
   */
  export type WorkoutSetFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutSet
     */
    select?: WorkoutSetSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutSetInclude<ExtArgs> | null
    /**
     * Filter, which WorkoutSets to fetch.
     */
    where?: WorkoutSetWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of WorkoutSets to fetch.
     */
    orderBy?: WorkoutSetOrderByWithRelationInput | WorkoutSetOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing WorkoutSets.
     */
    cursor?: WorkoutSetWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` WorkoutSets from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` WorkoutSets.
     */
    skip?: number
    distinct?: WorkoutSetScalarFieldEnum | WorkoutSetScalarFieldEnum[]
  }

  /**
   * WorkoutSet create
   */
  export type WorkoutSetCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutSet
     */
    select?: WorkoutSetSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutSetInclude<ExtArgs> | null
    /**
     * The data needed to create a WorkoutSet.
     */
    data: XOR<WorkoutSetCreateInput, WorkoutSetUncheckedCreateInput>
  }

  /**
   * WorkoutSet createMany
   */
  export type WorkoutSetCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many WorkoutSets.
     */
    data: WorkoutSetCreateManyInput | WorkoutSetCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * WorkoutSet createManyAndReturn
   */
  export type WorkoutSetCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutSet
     */
    select?: WorkoutSetSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many WorkoutSets.
     */
    data: WorkoutSetCreateManyInput | WorkoutSetCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutSetIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * WorkoutSet update
   */
  export type WorkoutSetUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutSet
     */
    select?: WorkoutSetSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutSetInclude<ExtArgs> | null
    /**
     * The data needed to update a WorkoutSet.
     */
    data: XOR<WorkoutSetUpdateInput, WorkoutSetUncheckedUpdateInput>
    /**
     * Choose, which WorkoutSet to update.
     */
    where: WorkoutSetWhereUniqueInput
  }

  /**
   * WorkoutSet updateMany
   */
  export type WorkoutSetUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update WorkoutSets.
     */
    data: XOR<WorkoutSetUpdateManyMutationInput, WorkoutSetUncheckedUpdateManyInput>
    /**
     * Filter which WorkoutSets to update
     */
    where?: WorkoutSetWhereInput
  }

  /**
   * WorkoutSet upsert
   */
  export type WorkoutSetUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutSet
     */
    select?: WorkoutSetSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutSetInclude<ExtArgs> | null
    /**
     * The filter to search for the WorkoutSet to update in case it exists.
     */
    where: WorkoutSetWhereUniqueInput
    /**
     * In case the WorkoutSet found by the `where` argument doesn't exist, create a new WorkoutSet with this data.
     */
    create: XOR<WorkoutSetCreateInput, WorkoutSetUncheckedCreateInput>
    /**
     * In case the WorkoutSet was found with the provided `where` argument, update it with this data.
     */
    update: XOR<WorkoutSetUpdateInput, WorkoutSetUncheckedUpdateInput>
  }

  /**
   * WorkoutSet delete
   */
  export type WorkoutSetDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutSet
     */
    select?: WorkoutSetSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutSetInclude<ExtArgs> | null
    /**
     * Filter which WorkoutSet to delete.
     */
    where: WorkoutSetWhereUniqueInput
  }

  /**
   * WorkoutSet deleteMany
   */
  export type WorkoutSetDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which WorkoutSets to delete
     */
    where?: WorkoutSetWhereInput
  }

  /**
   * WorkoutSet without action
   */
  export type WorkoutSetDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutSet
     */
    select?: WorkoutSetSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutSetInclude<ExtArgs> | null
  }


  /**
   * Model Food
   */

  export type AggregateFood = {
    _count: FoodCountAggregateOutputType | null
    _avg: FoodAvgAggregateOutputType | null
    _sum: FoodSumAggregateOutputType | null
    _min: FoodMinAggregateOutputType | null
    _max: FoodMaxAggregateOutputType | null
  }

  export type FoodAvgAggregateOutputType = {
    fdcId: number | null
    calories: number | null
    protein: number | null
    carbs: number | null
    fats: number | null
  }

  export type FoodSumAggregateOutputType = {
    fdcId: number | null
    calories: number | null
    protein: number | null
    carbs: number | null
    fats: number | null
  }

  export type FoodMinAggregateOutputType = {
    id: string | null
    fdcId: number | null
    name: string | null
    calories: number | null
    protein: number | null
    carbs: number | null
    fats: number | null
    source: string | null
    imageUrl: string | null
  }

  export type FoodMaxAggregateOutputType = {
    id: string | null
    fdcId: number | null
    name: string | null
    calories: number | null
    protein: number | null
    carbs: number | null
    fats: number | null
    source: string | null
    imageUrl: string | null
  }

  export type FoodCountAggregateOutputType = {
    id: number
    fdcId: number
    name: number
    calories: number
    protein: number
    carbs: number
    fats: number
    source: number
    imageUrl: number
    _all: number
  }


  export type FoodAvgAggregateInputType = {
    fdcId?: true
    calories?: true
    protein?: true
    carbs?: true
    fats?: true
  }

  export type FoodSumAggregateInputType = {
    fdcId?: true
    calories?: true
    protein?: true
    carbs?: true
    fats?: true
  }

  export type FoodMinAggregateInputType = {
    id?: true
    fdcId?: true
    name?: true
    calories?: true
    protein?: true
    carbs?: true
    fats?: true
    source?: true
    imageUrl?: true
  }

  export type FoodMaxAggregateInputType = {
    id?: true
    fdcId?: true
    name?: true
    calories?: true
    protein?: true
    carbs?: true
    fats?: true
    source?: true
    imageUrl?: true
  }

  export type FoodCountAggregateInputType = {
    id?: true
    fdcId?: true
    name?: true
    calories?: true
    protein?: true
    carbs?: true
    fats?: true
    source?: true
    imageUrl?: true
    _all?: true
  }

  export type FoodAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Food to aggregate.
     */
    where?: FoodWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Foods to fetch.
     */
    orderBy?: FoodOrderByWithRelationInput | FoodOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: FoodWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Foods from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Foods.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Foods
    **/
    _count?: true | FoodCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: FoodAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: FoodSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: FoodMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: FoodMaxAggregateInputType
  }

  export type GetFoodAggregateType<T extends FoodAggregateArgs> = {
        [P in keyof T & keyof AggregateFood]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateFood[P]>
      : GetScalarType<T[P], AggregateFood[P]>
  }




  export type FoodGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: FoodWhereInput
    orderBy?: FoodOrderByWithAggregationInput | FoodOrderByWithAggregationInput[]
    by: FoodScalarFieldEnum[] | FoodScalarFieldEnum
    having?: FoodScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: FoodCountAggregateInputType | true
    _avg?: FoodAvgAggregateInputType
    _sum?: FoodSumAggregateInputType
    _min?: FoodMinAggregateInputType
    _max?: FoodMaxAggregateInputType
  }

  export type FoodGroupByOutputType = {
    id: string
    fdcId: number
    name: string
    calories: number
    protein: number
    carbs: number
    fats: number
    source: string
    imageUrl: string | null
    _count: FoodCountAggregateOutputType | null
    _avg: FoodAvgAggregateOutputType | null
    _sum: FoodSumAggregateOutputType | null
    _min: FoodMinAggregateOutputType | null
    _max: FoodMaxAggregateOutputType | null
  }

  type GetFoodGroupByPayload<T extends FoodGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<FoodGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof FoodGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], FoodGroupByOutputType[P]>
            : GetScalarType<T[P], FoodGroupByOutputType[P]>
        }
      >
    >


  export type FoodSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    fdcId?: boolean
    name?: boolean
    calories?: boolean
    protein?: boolean
    carbs?: boolean
    fats?: boolean
    source?: boolean
    imageUrl?: boolean
  }, ExtArgs["result"]["food"]>

  export type FoodSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    fdcId?: boolean
    name?: boolean
    calories?: boolean
    protein?: boolean
    carbs?: boolean
    fats?: boolean
    source?: boolean
    imageUrl?: boolean
  }, ExtArgs["result"]["food"]>

  export type FoodSelectScalar = {
    id?: boolean
    fdcId?: boolean
    name?: boolean
    calories?: boolean
    protein?: boolean
    carbs?: boolean
    fats?: boolean
    source?: boolean
    imageUrl?: boolean
  }


  export type $FoodPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "Food"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: string
      fdcId: number
      name: string
      calories: number
      protein: number
      carbs: number
      fats: number
      source: string
      imageUrl: string | null
    }, ExtArgs["result"]["food"]>
    composites: {}
  }

  type FoodGetPayload<S extends boolean | null | undefined | FoodDefaultArgs> = $Result.GetResult<Prisma.$FoodPayload, S>

  type FoodCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<FoodFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: FoodCountAggregateInputType | true
    }

  export interface FoodDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['Food'], meta: { name: 'Food' } }
    /**
     * Find zero or one Food that matches the filter.
     * @param {FoodFindUniqueArgs} args - Arguments to find a Food
     * @example
     * // Get one Food
     * const food = await prisma.food.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends FoodFindUniqueArgs>(args: SelectSubset<T, FoodFindUniqueArgs<ExtArgs>>): Prisma__FoodClient<$Result.GetResult<Prisma.$FoodPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one Food that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {FoodFindUniqueOrThrowArgs} args - Arguments to find a Food
     * @example
     * // Get one Food
     * const food = await prisma.food.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends FoodFindUniqueOrThrowArgs>(args: SelectSubset<T, FoodFindUniqueOrThrowArgs<ExtArgs>>): Prisma__FoodClient<$Result.GetResult<Prisma.$FoodPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first Food that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {FoodFindFirstArgs} args - Arguments to find a Food
     * @example
     * // Get one Food
     * const food = await prisma.food.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends FoodFindFirstArgs>(args?: SelectSubset<T, FoodFindFirstArgs<ExtArgs>>): Prisma__FoodClient<$Result.GetResult<Prisma.$FoodPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first Food that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {FoodFindFirstOrThrowArgs} args - Arguments to find a Food
     * @example
     * // Get one Food
     * const food = await prisma.food.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends FoodFindFirstOrThrowArgs>(args?: SelectSubset<T, FoodFindFirstOrThrowArgs<ExtArgs>>): Prisma__FoodClient<$Result.GetResult<Prisma.$FoodPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more Foods that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {FoodFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Foods
     * const foods = await prisma.food.findMany()
     * 
     * // Get first 10 Foods
     * const foods = await prisma.food.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const foodWithIdOnly = await prisma.food.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends FoodFindManyArgs>(args?: SelectSubset<T, FoodFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$FoodPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a Food.
     * @param {FoodCreateArgs} args - Arguments to create a Food.
     * @example
     * // Create one Food
     * const Food = await prisma.food.create({
     *   data: {
     *     // ... data to create a Food
     *   }
     * })
     * 
     */
    create<T extends FoodCreateArgs>(args: SelectSubset<T, FoodCreateArgs<ExtArgs>>): Prisma__FoodClient<$Result.GetResult<Prisma.$FoodPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many Foods.
     * @param {FoodCreateManyArgs} args - Arguments to create many Foods.
     * @example
     * // Create many Foods
     * const food = await prisma.food.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends FoodCreateManyArgs>(args?: SelectSubset<T, FoodCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Foods and returns the data saved in the database.
     * @param {FoodCreateManyAndReturnArgs} args - Arguments to create many Foods.
     * @example
     * // Create many Foods
     * const food = await prisma.food.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Foods and only return the `id`
     * const foodWithIdOnly = await prisma.food.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends FoodCreateManyAndReturnArgs>(args?: SelectSubset<T, FoodCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$FoodPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a Food.
     * @param {FoodDeleteArgs} args - Arguments to delete one Food.
     * @example
     * // Delete one Food
     * const Food = await prisma.food.delete({
     *   where: {
     *     // ... filter to delete one Food
     *   }
     * })
     * 
     */
    delete<T extends FoodDeleteArgs>(args: SelectSubset<T, FoodDeleteArgs<ExtArgs>>): Prisma__FoodClient<$Result.GetResult<Prisma.$FoodPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one Food.
     * @param {FoodUpdateArgs} args - Arguments to update one Food.
     * @example
     * // Update one Food
     * const food = await prisma.food.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends FoodUpdateArgs>(args: SelectSubset<T, FoodUpdateArgs<ExtArgs>>): Prisma__FoodClient<$Result.GetResult<Prisma.$FoodPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more Foods.
     * @param {FoodDeleteManyArgs} args - Arguments to filter Foods to delete.
     * @example
     * // Delete a few Foods
     * const { count } = await prisma.food.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends FoodDeleteManyArgs>(args?: SelectSubset<T, FoodDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Foods.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {FoodUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Foods
     * const food = await prisma.food.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends FoodUpdateManyArgs>(args: SelectSubset<T, FoodUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one Food.
     * @param {FoodUpsertArgs} args - Arguments to update or create a Food.
     * @example
     * // Update or create a Food
     * const food = await prisma.food.upsert({
     *   create: {
     *     // ... data to create a Food
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Food we want to update
     *   }
     * })
     */
    upsert<T extends FoodUpsertArgs>(args: SelectSubset<T, FoodUpsertArgs<ExtArgs>>): Prisma__FoodClient<$Result.GetResult<Prisma.$FoodPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of Foods.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {FoodCountArgs} args - Arguments to filter Foods to count.
     * @example
     * // Count the number of Foods
     * const count = await prisma.food.count({
     *   where: {
     *     // ... the filter for the Foods we want to count
     *   }
     * })
    **/
    count<T extends FoodCountArgs>(
      args?: Subset<T, FoodCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], FoodCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Food.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {FoodAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends FoodAggregateArgs>(args: Subset<T, FoodAggregateArgs>): Prisma.PrismaPromise<GetFoodAggregateType<T>>

    /**
     * Group by Food.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {FoodGroupByArgs} args - Group by arguments.
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
      T extends FoodGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: FoodGroupByArgs['orderBy'] }
        : { orderBy?: FoodGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, FoodGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetFoodGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the Food model
   */
  readonly fields: FoodFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for Food.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__FoodClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
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
   * Fields of the Food model
   */ 
  interface FoodFieldRefs {
    readonly id: FieldRef<"Food", 'String'>
    readonly fdcId: FieldRef<"Food", 'Int'>
    readonly name: FieldRef<"Food", 'String'>
    readonly calories: FieldRef<"Food", 'Float'>
    readonly protein: FieldRef<"Food", 'Float'>
    readonly carbs: FieldRef<"Food", 'Float'>
    readonly fats: FieldRef<"Food", 'Float'>
    readonly source: FieldRef<"Food", 'String'>
    readonly imageUrl: FieldRef<"Food", 'String'>
  }
    

  // Custom InputTypes
  /**
   * Food findUnique
   */
  export type FoodFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Food
     */
    select?: FoodSelect<ExtArgs> | null
    /**
     * Filter, which Food to fetch.
     */
    where: FoodWhereUniqueInput
  }

  /**
   * Food findUniqueOrThrow
   */
  export type FoodFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Food
     */
    select?: FoodSelect<ExtArgs> | null
    /**
     * Filter, which Food to fetch.
     */
    where: FoodWhereUniqueInput
  }

  /**
   * Food findFirst
   */
  export type FoodFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Food
     */
    select?: FoodSelect<ExtArgs> | null
    /**
     * Filter, which Food to fetch.
     */
    where?: FoodWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Foods to fetch.
     */
    orderBy?: FoodOrderByWithRelationInput | FoodOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Foods.
     */
    cursor?: FoodWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Foods from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Foods.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Foods.
     */
    distinct?: FoodScalarFieldEnum | FoodScalarFieldEnum[]
  }

  /**
   * Food findFirstOrThrow
   */
  export type FoodFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Food
     */
    select?: FoodSelect<ExtArgs> | null
    /**
     * Filter, which Food to fetch.
     */
    where?: FoodWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Foods to fetch.
     */
    orderBy?: FoodOrderByWithRelationInput | FoodOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Foods.
     */
    cursor?: FoodWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Foods from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Foods.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Foods.
     */
    distinct?: FoodScalarFieldEnum | FoodScalarFieldEnum[]
  }

  /**
   * Food findMany
   */
  export type FoodFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Food
     */
    select?: FoodSelect<ExtArgs> | null
    /**
     * Filter, which Foods to fetch.
     */
    where?: FoodWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Foods to fetch.
     */
    orderBy?: FoodOrderByWithRelationInput | FoodOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Foods.
     */
    cursor?: FoodWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Foods from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Foods.
     */
    skip?: number
    distinct?: FoodScalarFieldEnum | FoodScalarFieldEnum[]
  }

  /**
   * Food create
   */
  export type FoodCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Food
     */
    select?: FoodSelect<ExtArgs> | null
    /**
     * The data needed to create a Food.
     */
    data: XOR<FoodCreateInput, FoodUncheckedCreateInput>
  }

  /**
   * Food createMany
   */
  export type FoodCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Foods.
     */
    data: FoodCreateManyInput | FoodCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Food createManyAndReturn
   */
  export type FoodCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Food
     */
    select?: FoodSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many Foods.
     */
    data: FoodCreateManyInput | FoodCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Food update
   */
  export type FoodUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Food
     */
    select?: FoodSelect<ExtArgs> | null
    /**
     * The data needed to update a Food.
     */
    data: XOR<FoodUpdateInput, FoodUncheckedUpdateInput>
    /**
     * Choose, which Food to update.
     */
    where: FoodWhereUniqueInput
  }

  /**
   * Food updateMany
   */
  export type FoodUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Foods.
     */
    data: XOR<FoodUpdateManyMutationInput, FoodUncheckedUpdateManyInput>
    /**
     * Filter which Foods to update
     */
    where?: FoodWhereInput
  }

  /**
   * Food upsert
   */
  export type FoodUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Food
     */
    select?: FoodSelect<ExtArgs> | null
    /**
     * The filter to search for the Food to update in case it exists.
     */
    where: FoodWhereUniqueInput
    /**
     * In case the Food found by the `where` argument doesn't exist, create a new Food with this data.
     */
    create: XOR<FoodCreateInput, FoodUncheckedCreateInput>
    /**
     * In case the Food was found with the provided `where` argument, update it with this data.
     */
    update: XOR<FoodUpdateInput, FoodUncheckedUpdateInput>
  }

  /**
   * Food delete
   */
  export type FoodDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Food
     */
    select?: FoodSelect<ExtArgs> | null
    /**
     * Filter which Food to delete.
     */
    where: FoodWhereUniqueInput
  }

  /**
   * Food deleteMany
   */
  export type FoodDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Foods to delete
     */
    where?: FoodWhereInput
  }

  /**
   * Food without action
   */
  export type FoodDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Food
     */
    select?: FoodSelect<ExtArgs> | null
  }


  /**
   * Model NutritionLog
   */

  export type AggregateNutritionLog = {
    _count: NutritionLogCountAggregateOutputType | null
    _avg: NutritionLogAvgAggregateOutputType | null
    _sum: NutritionLogSumAggregateOutputType | null
    _min: NutritionLogMinAggregateOutputType | null
    _max: NutritionLogMaxAggregateOutputType | null
  }

  export type NutritionLogAvgAggregateOutputType = {
    calories: number | null
    protein: number | null
    carbs: number | null
    fats: number | null
  }

  export type NutritionLogSumAggregateOutputType = {
    calories: number | null
    protein: number | null
    carbs: number | null
    fats: number | null
  }

  export type NutritionLogMinAggregateOutputType = {
    id: string | null
    userId: string | null
    date: Date | null
    mealType: string | null
    foodName: string | null
    calories: number | null
    protein: number | null
    carbs: number | null
    fats: number | null
    notes: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type NutritionLogMaxAggregateOutputType = {
    id: string | null
    userId: string | null
    date: Date | null
    mealType: string | null
    foodName: string | null
    calories: number | null
    protein: number | null
    carbs: number | null
    fats: number | null
    notes: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type NutritionLogCountAggregateOutputType = {
    id: number
    userId: number
    date: number
    mealType: number
    foodName: number
    calories: number
    protein: number
    carbs: number
    fats: number
    notes: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type NutritionLogAvgAggregateInputType = {
    calories?: true
    protein?: true
    carbs?: true
    fats?: true
  }

  export type NutritionLogSumAggregateInputType = {
    calories?: true
    protein?: true
    carbs?: true
    fats?: true
  }

  export type NutritionLogMinAggregateInputType = {
    id?: true
    userId?: true
    date?: true
    mealType?: true
    foodName?: true
    calories?: true
    protein?: true
    carbs?: true
    fats?: true
    notes?: true
    createdAt?: true
    updatedAt?: true
  }

  export type NutritionLogMaxAggregateInputType = {
    id?: true
    userId?: true
    date?: true
    mealType?: true
    foodName?: true
    calories?: true
    protein?: true
    carbs?: true
    fats?: true
    notes?: true
    createdAt?: true
    updatedAt?: true
  }

  export type NutritionLogCountAggregateInputType = {
    id?: true
    userId?: true
    date?: true
    mealType?: true
    foodName?: true
    calories?: true
    protein?: true
    carbs?: true
    fats?: true
    notes?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type NutritionLogAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which NutritionLog to aggregate.
     */
    where?: NutritionLogWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of NutritionLogs to fetch.
     */
    orderBy?: NutritionLogOrderByWithRelationInput | NutritionLogOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: NutritionLogWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` NutritionLogs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` NutritionLogs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned NutritionLogs
    **/
    _count?: true | NutritionLogCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: NutritionLogAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: NutritionLogSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: NutritionLogMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: NutritionLogMaxAggregateInputType
  }

  export type GetNutritionLogAggregateType<T extends NutritionLogAggregateArgs> = {
        [P in keyof T & keyof AggregateNutritionLog]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateNutritionLog[P]>
      : GetScalarType<T[P], AggregateNutritionLog[P]>
  }




  export type NutritionLogGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: NutritionLogWhereInput
    orderBy?: NutritionLogOrderByWithAggregationInput | NutritionLogOrderByWithAggregationInput[]
    by: NutritionLogScalarFieldEnum[] | NutritionLogScalarFieldEnum
    having?: NutritionLogScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: NutritionLogCountAggregateInputType | true
    _avg?: NutritionLogAvgAggregateInputType
    _sum?: NutritionLogSumAggregateInputType
    _min?: NutritionLogMinAggregateInputType
    _max?: NutritionLogMaxAggregateInputType
  }

  export type NutritionLogGroupByOutputType = {
    id: string
    userId: string
    date: Date
    mealType: string
    foodName: string
    calories: number
    protein: number | null
    carbs: number | null
    fats: number | null
    notes: string | null
    createdAt: Date
    updatedAt: Date
    _count: NutritionLogCountAggregateOutputType | null
    _avg: NutritionLogAvgAggregateOutputType | null
    _sum: NutritionLogSumAggregateOutputType | null
    _min: NutritionLogMinAggregateOutputType | null
    _max: NutritionLogMaxAggregateOutputType | null
  }

  type GetNutritionLogGroupByPayload<T extends NutritionLogGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<NutritionLogGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof NutritionLogGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], NutritionLogGroupByOutputType[P]>
            : GetScalarType<T[P], NutritionLogGroupByOutputType[P]>
        }
      >
    >


  export type NutritionLogSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    userId?: boolean
    date?: boolean
    mealType?: boolean
    foodName?: boolean
    calories?: boolean
    protein?: boolean
    carbs?: boolean
    fats?: boolean
    notes?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["nutritionLog"]>

  export type NutritionLogSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    userId?: boolean
    date?: boolean
    mealType?: boolean
    foodName?: boolean
    calories?: boolean
    protein?: boolean
    carbs?: boolean
    fats?: boolean
    notes?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["nutritionLog"]>

  export type NutritionLogSelectScalar = {
    id?: boolean
    userId?: boolean
    date?: boolean
    mealType?: boolean
    foodName?: boolean
    calories?: boolean
    protein?: boolean
    carbs?: boolean
    fats?: boolean
    notes?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }


  export type $NutritionLogPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "NutritionLog"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: string
      userId: string
      date: Date
      mealType: string
      foodName: string
      calories: number
      protein: number | null
      carbs: number | null
      fats: number | null
      notes: string | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["nutritionLog"]>
    composites: {}
  }

  type NutritionLogGetPayload<S extends boolean | null | undefined | NutritionLogDefaultArgs> = $Result.GetResult<Prisma.$NutritionLogPayload, S>

  type NutritionLogCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<NutritionLogFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: NutritionLogCountAggregateInputType | true
    }

  export interface NutritionLogDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['NutritionLog'], meta: { name: 'NutritionLog' } }
    /**
     * Find zero or one NutritionLog that matches the filter.
     * @param {NutritionLogFindUniqueArgs} args - Arguments to find a NutritionLog
     * @example
     * // Get one NutritionLog
     * const nutritionLog = await prisma.nutritionLog.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends NutritionLogFindUniqueArgs>(args: SelectSubset<T, NutritionLogFindUniqueArgs<ExtArgs>>): Prisma__NutritionLogClient<$Result.GetResult<Prisma.$NutritionLogPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one NutritionLog that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {NutritionLogFindUniqueOrThrowArgs} args - Arguments to find a NutritionLog
     * @example
     * // Get one NutritionLog
     * const nutritionLog = await prisma.nutritionLog.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends NutritionLogFindUniqueOrThrowArgs>(args: SelectSubset<T, NutritionLogFindUniqueOrThrowArgs<ExtArgs>>): Prisma__NutritionLogClient<$Result.GetResult<Prisma.$NutritionLogPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first NutritionLog that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {NutritionLogFindFirstArgs} args - Arguments to find a NutritionLog
     * @example
     * // Get one NutritionLog
     * const nutritionLog = await prisma.nutritionLog.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends NutritionLogFindFirstArgs>(args?: SelectSubset<T, NutritionLogFindFirstArgs<ExtArgs>>): Prisma__NutritionLogClient<$Result.GetResult<Prisma.$NutritionLogPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first NutritionLog that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {NutritionLogFindFirstOrThrowArgs} args - Arguments to find a NutritionLog
     * @example
     * // Get one NutritionLog
     * const nutritionLog = await prisma.nutritionLog.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends NutritionLogFindFirstOrThrowArgs>(args?: SelectSubset<T, NutritionLogFindFirstOrThrowArgs<ExtArgs>>): Prisma__NutritionLogClient<$Result.GetResult<Prisma.$NutritionLogPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more NutritionLogs that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {NutritionLogFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all NutritionLogs
     * const nutritionLogs = await prisma.nutritionLog.findMany()
     * 
     * // Get first 10 NutritionLogs
     * const nutritionLogs = await prisma.nutritionLog.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const nutritionLogWithIdOnly = await prisma.nutritionLog.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends NutritionLogFindManyArgs>(args?: SelectSubset<T, NutritionLogFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$NutritionLogPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a NutritionLog.
     * @param {NutritionLogCreateArgs} args - Arguments to create a NutritionLog.
     * @example
     * // Create one NutritionLog
     * const NutritionLog = await prisma.nutritionLog.create({
     *   data: {
     *     // ... data to create a NutritionLog
     *   }
     * })
     * 
     */
    create<T extends NutritionLogCreateArgs>(args: SelectSubset<T, NutritionLogCreateArgs<ExtArgs>>): Prisma__NutritionLogClient<$Result.GetResult<Prisma.$NutritionLogPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many NutritionLogs.
     * @param {NutritionLogCreateManyArgs} args - Arguments to create many NutritionLogs.
     * @example
     * // Create many NutritionLogs
     * const nutritionLog = await prisma.nutritionLog.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends NutritionLogCreateManyArgs>(args?: SelectSubset<T, NutritionLogCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many NutritionLogs and returns the data saved in the database.
     * @param {NutritionLogCreateManyAndReturnArgs} args - Arguments to create many NutritionLogs.
     * @example
     * // Create many NutritionLogs
     * const nutritionLog = await prisma.nutritionLog.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many NutritionLogs and only return the `id`
     * const nutritionLogWithIdOnly = await prisma.nutritionLog.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends NutritionLogCreateManyAndReturnArgs>(args?: SelectSubset<T, NutritionLogCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$NutritionLogPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a NutritionLog.
     * @param {NutritionLogDeleteArgs} args - Arguments to delete one NutritionLog.
     * @example
     * // Delete one NutritionLog
     * const NutritionLog = await prisma.nutritionLog.delete({
     *   where: {
     *     // ... filter to delete one NutritionLog
     *   }
     * })
     * 
     */
    delete<T extends NutritionLogDeleteArgs>(args: SelectSubset<T, NutritionLogDeleteArgs<ExtArgs>>): Prisma__NutritionLogClient<$Result.GetResult<Prisma.$NutritionLogPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one NutritionLog.
     * @param {NutritionLogUpdateArgs} args - Arguments to update one NutritionLog.
     * @example
     * // Update one NutritionLog
     * const nutritionLog = await prisma.nutritionLog.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends NutritionLogUpdateArgs>(args: SelectSubset<T, NutritionLogUpdateArgs<ExtArgs>>): Prisma__NutritionLogClient<$Result.GetResult<Prisma.$NutritionLogPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more NutritionLogs.
     * @param {NutritionLogDeleteManyArgs} args - Arguments to filter NutritionLogs to delete.
     * @example
     * // Delete a few NutritionLogs
     * const { count } = await prisma.nutritionLog.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends NutritionLogDeleteManyArgs>(args?: SelectSubset<T, NutritionLogDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more NutritionLogs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {NutritionLogUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many NutritionLogs
     * const nutritionLog = await prisma.nutritionLog.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends NutritionLogUpdateManyArgs>(args: SelectSubset<T, NutritionLogUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one NutritionLog.
     * @param {NutritionLogUpsertArgs} args - Arguments to update or create a NutritionLog.
     * @example
     * // Update or create a NutritionLog
     * const nutritionLog = await prisma.nutritionLog.upsert({
     *   create: {
     *     // ... data to create a NutritionLog
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the NutritionLog we want to update
     *   }
     * })
     */
    upsert<T extends NutritionLogUpsertArgs>(args: SelectSubset<T, NutritionLogUpsertArgs<ExtArgs>>): Prisma__NutritionLogClient<$Result.GetResult<Prisma.$NutritionLogPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of NutritionLogs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {NutritionLogCountArgs} args - Arguments to filter NutritionLogs to count.
     * @example
     * // Count the number of NutritionLogs
     * const count = await prisma.nutritionLog.count({
     *   where: {
     *     // ... the filter for the NutritionLogs we want to count
     *   }
     * })
    **/
    count<T extends NutritionLogCountArgs>(
      args?: Subset<T, NutritionLogCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], NutritionLogCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a NutritionLog.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {NutritionLogAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends NutritionLogAggregateArgs>(args: Subset<T, NutritionLogAggregateArgs>): Prisma.PrismaPromise<GetNutritionLogAggregateType<T>>

    /**
     * Group by NutritionLog.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {NutritionLogGroupByArgs} args - Group by arguments.
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
      T extends NutritionLogGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: NutritionLogGroupByArgs['orderBy'] }
        : { orderBy?: NutritionLogGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, NutritionLogGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetNutritionLogGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the NutritionLog model
   */
  readonly fields: NutritionLogFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for NutritionLog.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__NutritionLogClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
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
   * Fields of the NutritionLog model
   */ 
  interface NutritionLogFieldRefs {
    readonly id: FieldRef<"NutritionLog", 'String'>
    readonly userId: FieldRef<"NutritionLog", 'String'>
    readonly date: FieldRef<"NutritionLog", 'DateTime'>
    readonly mealType: FieldRef<"NutritionLog", 'String'>
    readonly foodName: FieldRef<"NutritionLog", 'String'>
    readonly calories: FieldRef<"NutritionLog", 'Int'>
    readonly protein: FieldRef<"NutritionLog", 'Float'>
    readonly carbs: FieldRef<"NutritionLog", 'Float'>
    readonly fats: FieldRef<"NutritionLog", 'Float'>
    readonly notes: FieldRef<"NutritionLog", 'String'>
    readonly createdAt: FieldRef<"NutritionLog", 'DateTime'>
    readonly updatedAt: FieldRef<"NutritionLog", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * NutritionLog findUnique
   */
  export type NutritionLogFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the NutritionLog
     */
    select?: NutritionLogSelect<ExtArgs> | null
    /**
     * Filter, which NutritionLog to fetch.
     */
    where: NutritionLogWhereUniqueInput
  }

  /**
   * NutritionLog findUniqueOrThrow
   */
  export type NutritionLogFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the NutritionLog
     */
    select?: NutritionLogSelect<ExtArgs> | null
    /**
     * Filter, which NutritionLog to fetch.
     */
    where: NutritionLogWhereUniqueInput
  }

  /**
   * NutritionLog findFirst
   */
  export type NutritionLogFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the NutritionLog
     */
    select?: NutritionLogSelect<ExtArgs> | null
    /**
     * Filter, which NutritionLog to fetch.
     */
    where?: NutritionLogWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of NutritionLogs to fetch.
     */
    orderBy?: NutritionLogOrderByWithRelationInput | NutritionLogOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for NutritionLogs.
     */
    cursor?: NutritionLogWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` NutritionLogs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` NutritionLogs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of NutritionLogs.
     */
    distinct?: NutritionLogScalarFieldEnum | NutritionLogScalarFieldEnum[]
  }

  /**
   * NutritionLog findFirstOrThrow
   */
  export type NutritionLogFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the NutritionLog
     */
    select?: NutritionLogSelect<ExtArgs> | null
    /**
     * Filter, which NutritionLog to fetch.
     */
    where?: NutritionLogWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of NutritionLogs to fetch.
     */
    orderBy?: NutritionLogOrderByWithRelationInput | NutritionLogOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for NutritionLogs.
     */
    cursor?: NutritionLogWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` NutritionLogs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` NutritionLogs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of NutritionLogs.
     */
    distinct?: NutritionLogScalarFieldEnum | NutritionLogScalarFieldEnum[]
  }

  /**
   * NutritionLog findMany
   */
  export type NutritionLogFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the NutritionLog
     */
    select?: NutritionLogSelect<ExtArgs> | null
    /**
     * Filter, which NutritionLogs to fetch.
     */
    where?: NutritionLogWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of NutritionLogs to fetch.
     */
    orderBy?: NutritionLogOrderByWithRelationInput | NutritionLogOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing NutritionLogs.
     */
    cursor?: NutritionLogWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` NutritionLogs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` NutritionLogs.
     */
    skip?: number
    distinct?: NutritionLogScalarFieldEnum | NutritionLogScalarFieldEnum[]
  }

  /**
   * NutritionLog create
   */
  export type NutritionLogCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the NutritionLog
     */
    select?: NutritionLogSelect<ExtArgs> | null
    /**
     * The data needed to create a NutritionLog.
     */
    data: XOR<NutritionLogCreateInput, NutritionLogUncheckedCreateInput>
  }

  /**
   * NutritionLog createMany
   */
  export type NutritionLogCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many NutritionLogs.
     */
    data: NutritionLogCreateManyInput | NutritionLogCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * NutritionLog createManyAndReturn
   */
  export type NutritionLogCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the NutritionLog
     */
    select?: NutritionLogSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many NutritionLogs.
     */
    data: NutritionLogCreateManyInput | NutritionLogCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * NutritionLog update
   */
  export type NutritionLogUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the NutritionLog
     */
    select?: NutritionLogSelect<ExtArgs> | null
    /**
     * The data needed to update a NutritionLog.
     */
    data: XOR<NutritionLogUpdateInput, NutritionLogUncheckedUpdateInput>
    /**
     * Choose, which NutritionLog to update.
     */
    where: NutritionLogWhereUniqueInput
  }

  /**
   * NutritionLog updateMany
   */
  export type NutritionLogUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update NutritionLogs.
     */
    data: XOR<NutritionLogUpdateManyMutationInput, NutritionLogUncheckedUpdateManyInput>
    /**
     * Filter which NutritionLogs to update
     */
    where?: NutritionLogWhereInput
  }

  /**
   * NutritionLog upsert
   */
  export type NutritionLogUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the NutritionLog
     */
    select?: NutritionLogSelect<ExtArgs> | null
    /**
     * The filter to search for the NutritionLog to update in case it exists.
     */
    where: NutritionLogWhereUniqueInput
    /**
     * In case the NutritionLog found by the `where` argument doesn't exist, create a new NutritionLog with this data.
     */
    create: XOR<NutritionLogCreateInput, NutritionLogUncheckedCreateInput>
    /**
     * In case the NutritionLog was found with the provided `where` argument, update it with this data.
     */
    update: XOR<NutritionLogUpdateInput, NutritionLogUncheckedUpdateInput>
  }

  /**
   * NutritionLog delete
   */
  export type NutritionLogDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the NutritionLog
     */
    select?: NutritionLogSelect<ExtArgs> | null
    /**
     * Filter which NutritionLog to delete.
     */
    where: NutritionLogWhereUniqueInput
  }

  /**
   * NutritionLog deleteMany
   */
  export type NutritionLogDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which NutritionLogs to delete
     */
    where?: NutritionLogWhereInput
  }

  /**
   * NutritionLog without action
   */
  export type NutritionLogDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the NutritionLog
     */
    select?: NutritionLogSelect<ExtArgs> | null
  }


  /**
   * Model NutritionGoal
   */

  export type AggregateNutritionGoal = {
    _count: NutritionGoalCountAggregateOutputType | null
    _avg: NutritionGoalAvgAggregateOutputType | null
    _sum: NutritionGoalSumAggregateOutputType | null
    _min: NutritionGoalMinAggregateOutputType | null
    _max: NutritionGoalMaxAggregateOutputType | null
  }

  export type NutritionGoalAvgAggregateOutputType = {
    calories: number | null
    protein: number | null
    carbs: number | null
    fat: number | null
    waterMl: number | null
  }

  export type NutritionGoalSumAggregateOutputType = {
    calories: number | null
    protein: number | null
    carbs: number | null
    fat: number | null
    waterMl: number | null
  }

  export type NutritionGoalMinAggregateOutputType = {
    id: string | null
    userId: string | null
    calories: number | null
    protein: number | null
    carbs: number | null
    fat: number | null
    waterMl: number | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type NutritionGoalMaxAggregateOutputType = {
    id: string | null
    userId: string | null
    calories: number | null
    protein: number | null
    carbs: number | null
    fat: number | null
    waterMl: number | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type NutritionGoalCountAggregateOutputType = {
    id: number
    userId: number
    calories: number
    protein: number
    carbs: number
    fat: number
    waterMl: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type NutritionGoalAvgAggregateInputType = {
    calories?: true
    protein?: true
    carbs?: true
    fat?: true
    waterMl?: true
  }

  export type NutritionGoalSumAggregateInputType = {
    calories?: true
    protein?: true
    carbs?: true
    fat?: true
    waterMl?: true
  }

  export type NutritionGoalMinAggregateInputType = {
    id?: true
    userId?: true
    calories?: true
    protein?: true
    carbs?: true
    fat?: true
    waterMl?: true
    createdAt?: true
    updatedAt?: true
  }

  export type NutritionGoalMaxAggregateInputType = {
    id?: true
    userId?: true
    calories?: true
    protein?: true
    carbs?: true
    fat?: true
    waterMl?: true
    createdAt?: true
    updatedAt?: true
  }

  export type NutritionGoalCountAggregateInputType = {
    id?: true
    userId?: true
    calories?: true
    protein?: true
    carbs?: true
    fat?: true
    waterMl?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type NutritionGoalAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which NutritionGoal to aggregate.
     */
    where?: NutritionGoalWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of NutritionGoals to fetch.
     */
    orderBy?: NutritionGoalOrderByWithRelationInput | NutritionGoalOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: NutritionGoalWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` NutritionGoals from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` NutritionGoals.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned NutritionGoals
    **/
    _count?: true | NutritionGoalCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: NutritionGoalAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: NutritionGoalSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: NutritionGoalMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: NutritionGoalMaxAggregateInputType
  }

  export type GetNutritionGoalAggregateType<T extends NutritionGoalAggregateArgs> = {
        [P in keyof T & keyof AggregateNutritionGoal]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateNutritionGoal[P]>
      : GetScalarType<T[P], AggregateNutritionGoal[P]>
  }




  export type NutritionGoalGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: NutritionGoalWhereInput
    orderBy?: NutritionGoalOrderByWithAggregationInput | NutritionGoalOrderByWithAggregationInput[]
    by: NutritionGoalScalarFieldEnum[] | NutritionGoalScalarFieldEnum
    having?: NutritionGoalScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: NutritionGoalCountAggregateInputType | true
    _avg?: NutritionGoalAvgAggregateInputType
    _sum?: NutritionGoalSumAggregateInputType
    _min?: NutritionGoalMinAggregateInputType
    _max?: NutritionGoalMaxAggregateInputType
  }

  export type NutritionGoalGroupByOutputType = {
    id: string
    userId: string
    calories: number
    protein: number
    carbs: number
    fat: number
    waterMl: number | null
    createdAt: Date
    updatedAt: Date
    _count: NutritionGoalCountAggregateOutputType | null
    _avg: NutritionGoalAvgAggregateOutputType | null
    _sum: NutritionGoalSumAggregateOutputType | null
    _min: NutritionGoalMinAggregateOutputType | null
    _max: NutritionGoalMaxAggregateOutputType | null
  }

  type GetNutritionGoalGroupByPayload<T extends NutritionGoalGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<NutritionGoalGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof NutritionGoalGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], NutritionGoalGroupByOutputType[P]>
            : GetScalarType<T[P], NutritionGoalGroupByOutputType[P]>
        }
      >
    >


  export type NutritionGoalSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    userId?: boolean
    calories?: boolean
    protein?: boolean
    carbs?: boolean
    fat?: boolean
    waterMl?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["nutritionGoal"]>

  export type NutritionGoalSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    userId?: boolean
    calories?: boolean
    protein?: boolean
    carbs?: boolean
    fat?: boolean
    waterMl?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["nutritionGoal"]>

  export type NutritionGoalSelectScalar = {
    id?: boolean
    userId?: boolean
    calories?: boolean
    protein?: boolean
    carbs?: boolean
    fat?: boolean
    waterMl?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }


  export type $NutritionGoalPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "NutritionGoal"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: string
      userId: string
      calories: number
      protein: number
      carbs: number
      fat: number
      waterMl: number | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["nutritionGoal"]>
    composites: {}
  }

  type NutritionGoalGetPayload<S extends boolean | null | undefined | NutritionGoalDefaultArgs> = $Result.GetResult<Prisma.$NutritionGoalPayload, S>

  type NutritionGoalCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<NutritionGoalFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: NutritionGoalCountAggregateInputType | true
    }

  export interface NutritionGoalDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['NutritionGoal'], meta: { name: 'NutritionGoal' } }
    /**
     * Find zero or one NutritionGoal that matches the filter.
     * @param {NutritionGoalFindUniqueArgs} args - Arguments to find a NutritionGoal
     * @example
     * // Get one NutritionGoal
     * const nutritionGoal = await prisma.nutritionGoal.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends NutritionGoalFindUniqueArgs>(args: SelectSubset<T, NutritionGoalFindUniqueArgs<ExtArgs>>): Prisma__NutritionGoalClient<$Result.GetResult<Prisma.$NutritionGoalPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one NutritionGoal that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {NutritionGoalFindUniqueOrThrowArgs} args - Arguments to find a NutritionGoal
     * @example
     * // Get one NutritionGoal
     * const nutritionGoal = await prisma.nutritionGoal.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends NutritionGoalFindUniqueOrThrowArgs>(args: SelectSubset<T, NutritionGoalFindUniqueOrThrowArgs<ExtArgs>>): Prisma__NutritionGoalClient<$Result.GetResult<Prisma.$NutritionGoalPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first NutritionGoal that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {NutritionGoalFindFirstArgs} args - Arguments to find a NutritionGoal
     * @example
     * // Get one NutritionGoal
     * const nutritionGoal = await prisma.nutritionGoal.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends NutritionGoalFindFirstArgs>(args?: SelectSubset<T, NutritionGoalFindFirstArgs<ExtArgs>>): Prisma__NutritionGoalClient<$Result.GetResult<Prisma.$NutritionGoalPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first NutritionGoal that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {NutritionGoalFindFirstOrThrowArgs} args - Arguments to find a NutritionGoal
     * @example
     * // Get one NutritionGoal
     * const nutritionGoal = await prisma.nutritionGoal.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends NutritionGoalFindFirstOrThrowArgs>(args?: SelectSubset<T, NutritionGoalFindFirstOrThrowArgs<ExtArgs>>): Prisma__NutritionGoalClient<$Result.GetResult<Prisma.$NutritionGoalPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more NutritionGoals that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {NutritionGoalFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all NutritionGoals
     * const nutritionGoals = await prisma.nutritionGoal.findMany()
     * 
     * // Get first 10 NutritionGoals
     * const nutritionGoals = await prisma.nutritionGoal.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const nutritionGoalWithIdOnly = await prisma.nutritionGoal.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends NutritionGoalFindManyArgs>(args?: SelectSubset<T, NutritionGoalFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$NutritionGoalPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a NutritionGoal.
     * @param {NutritionGoalCreateArgs} args - Arguments to create a NutritionGoal.
     * @example
     * // Create one NutritionGoal
     * const NutritionGoal = await prisma.nutritionGoal.create({
     *   data: {
     *     // ... data to create a NutritionGoal
     *   }
     * })
     * 
     */
    create<T extends NutritionGoalCreateArgs>(args: SelectSubset<T, NutritionGoalCreateArgs<ExtArgs>>): Prisma__NutritionGoalClient<$Result.GetResult<Prisma.$NutritionGoalPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many NutritionGoals.
     * @param {NutritionGoalCreateManyArgs} args - Arguments to create many NutritionGoals.
     * @example
     * // Create many NutritionGoals
     * const nutritionGoal = await prisma.nutritionGoal.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends NutritionGoalCreateManyArgs>(args?: SelectSubset<T, NutritionGoalCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many NutritionGoals and returns the data saved in the database.
     * @param {NutritionGoalCreateManyAndReturnArgs} args - Arguments to create many NutritionGoals.
     * @example
     * // Create many NutritionGoals
     * const nutritionGoal = await prisma.nutritionGoal.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many NutritionGoals and only return the `id`
     * const nutritionGoalWithIdOnly = await prisma.nutritionGoal.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends NutritionGoalCreateManyAndReturnArgs>(args?: SelectSubset<T, NutritionGoalCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$NutritionGoalPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a NutritionGoal.
     * @param {NutritionGoalDeleteArgs} args - Arguments to delete one NutritionGoal.
     * @example
     * // Delete one NutritionGoal
     * const NutritionGoal = await prisma.nutritionGoal.delete({
     *   where: {
     *     // ... filter to delete one NutritionGoal
     *   }
     * })
     * 
     */
    delete<T extends NutritionGoalDeleteArgs>(args: SelectSubset<T, NutritionGoalDeleteArgs<ExtArgs>>): Prisma__NutritionGoalClient<$Result.GetResult<Prisma.$NutritionGoalPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one NutritionGoal.
     * @param {NutritionGoalUpdateArgs} args - Arguments to update one NutritionGoal.
     * @example
     * // Update one NutritionGoal
     * const nutritionGoal = await prisma.nutritionGoal.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends NutritionGoalUpdateArgs>(args: SelectSubset<T, NutritionGoalUpdateArgs<ExtArgs>>): Prisma__NutritionGoalClient<$Result.GetResult<Prisma.$NutritionGoalPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more NutritionGoals.
     * @param {NutritionGoalDeleteManyArgs} args - Arguments to filter NutritionGoals to delete.
     * @example
     * // Delete a few NutritionGoals
     * const { count } = await prisma.nutritionGoal.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends NutritionGoalDeleteManyArgs>(args?: SelectSubset<T, NutritionGoalDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more NutritionGoals.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {NutritionGoalUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many NutritionGoals
     * const nutritionGoal = await prisma.nutritionGoal.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends NutritionGoalUpdateManyArgs>(args: SelectSubset<T, NutritionGoalUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one NutritionGoal.
     * @param {NutritionGoalUpsertArgs} args - Arguments to update or create a NutritionGoal.
     * @example
     * // Update or create a NutritionGoal
     * const nutritionGoal = await prisma.nutritionGoal.upsert({
     *   create: {
     *     // ... data to create a NutritionGoal
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the NutritionGoal we want to update
     *   }
     * })
     */
    upsert<T extends NutritionGoalUpsertArgs>(args: SelectSubset<T, NutritionGoalUpsertArgs<ExtArgs>>): Prisma__NutritionGoalClient<$Result.GetResult<Prisma.$NutritionGoalPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of NutritionGoals.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {NutritionGoalCountArgs} args - Arguments to filter NutritionGoals to count.
     * @example
     * // Count the number of NutritionGoals
     * const count = await prisma.nutritionGoal.count({
     *   where: {
     *     // ... the filter for the NutritionGoals we want to count
     *   }
     * })
    **/
    count<T extends NutritionGoalCountArgs>(
      args?: Subset<T, NutritionGoalCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], NutritionGoalCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a NutritionGoal.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {NutritionGoalAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends NutritionGoalAggregateArgs>(args: Subset<T, NutritionGoalAggregateArgs>): Prisma.PrismaPromise<GetNutritionGoalAggregateType<T>>

    /**
     * Group by NutritionGoal.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {NutritionGoalGroupByArgs} args - Group by arguments.
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
      T extends NutritionGoalGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: NutritionGoalGroupByArgs['orderBy'] }
        : { orderBy?: NutritionGoalGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, NutritionGoalGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetNutritionGoalGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the NutritionGoal model
   */
  readonly fields: NutritionGoalFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for NutritionGoal.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__NutritionGoalClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
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
   * Fields of the NutritionGoal model
   */ 
  interface NutritionGoalFieldRefs {
    readonly id: FieldRef<"NutritionGoal", 'String'>
    readonly userId: FieldRef<"NutritionGoal", 'String'>
    readonly calories: FieldRef<"NutritionGoal", 'Int'>
    readonly protein: FieldRef<"NutritionGoal", 'Float'>
    readonly carbs: FieldRef<"NutritionGoal", 'Float'>
    readonly fat: FieldRef<"NutritionGoal", 'Float'>
    readonly waterMl: FieldRef<"NutritionGoal", 'Int'>
    readonly createdAt: FieldRef<"NutritionGoal", 'DateTime'>
    readonly updatedAt: FieldRef<"NutritionGoal", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * NutritionGoal findUnique
   */
  export type NutritionGoalFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the NutritionGoal
     */
    select?: NutritionGoalSelect<ExtArgs> | null
    /**
     * Filter, which NutritionGoal to fetch.
     */
    where: NutritionGoalWhereUniqueInput
  }

  /**
   * NutritionGoal findUniqueOrThrow
   */
  export type NutritionGoalFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the NutritionGoal
     */
    select?: NutritionGoalSelect<ExtArgs> | null
    /**
     * Filter, which NutritionGoal to fetch.
     */
    where: NutritionGoalWhereUniqueInput
  }

  /**
   * NutritionGoal findFirst
   */
  export type NutritionGoalFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the NutritionGoal
     */
    select?: NutritionGoalSelect<ExtArgs> | null
    /**
     * Filter, which NutritionGoal to fetch.
     */
    where?: NutritionGoalWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of NutritionGoals to fetch.
     */
    orderBy?: NutritionGoalOrderByWithRelationInput | NutritionGoalOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for NutritionGoals.
     */
    cursor?: NutritionGoalWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` NutritionGoals from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` NutritionGoals.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of NutritionGoals.
     */
    distinct?: NutritionGoalScalarFieldEnum | NutritionGoalScalarFieldEnum[]
  }

  /**
   * NutritionGoal findFirstOrThrow
   */
  export type NutritionGoalFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the NutritionGoal
     */
    select?: NutritionGoalSelect<ExtArgs> | null
    /**
     * Filter, which NutritionGoal to fetch.
     */
    where?: NutritionGoalWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of NutritionGoals to fetch.
     */
    orderBy?: NutritionGoalOrderByWithRelationInput | NutritionGoalOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for NutritionGoals.
     */
    cursor?: NutritionGoalWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` NutritionGoals from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` NutritionGoals.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of NutritionGoals.
     */
    distinct?: NutritionGoalScalarFieldEnum | NutritionGoalScalarFieldEnum[]
  }

  /**
   * NutritionGoal findMany
   */
  export type NutritionGoalFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the NutritionGoal
     */
    select?: NutritionGoalSelect<ExtArgs> | null
    /**
     * Filter, which NutritionGoals to fetch.
     */
    where?: NutritionGoalWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of NutritionGoals to fetch.
     */
    orderBy?: NutritionGoalOrderByWithRelationInput | NutritionGoalOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing NutritionGoals.
     */
    cursor?: NutritionGoalWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` NutritionGoals from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` NutritionGoals.
     */
    skip?: number
    distinct?: NutritionGoalScalarFieldEnum | NutritionGoalScalarFieldEnum[]
  }

  /**
   * NutritionGoal create
   */
  export type NutritionGoalCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the NutritionGoal
     */
    select?: NutritionGoalSelect<ExtArgs> | null
    /**
     * The data needed to create a NutritionGoal.
     */
    data: XOR<NutritionGoalCreateInput, NutritionGoalUncheckedCreateInput>
  }

  /**
   * NutritionGoal createMany
   */
  export type NutritionGoalCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many NutritionGoals.
     */
    data: NutritionGoalCreateManyInput | NutritionGoalCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * NutritionGoal createManyAndReturn
   */
  export type NutritionGoalCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the NutritionGoal
     */
    select?: NutritionGoalSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many NutritionGoals.
     */
    data: NutritionGoalCreateManyInput | NutritionGoalCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * NutritionGoal update
   */
  export type NutritionGoalUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the NutritionGoal
     */
    select?: NutritionGoalSelect<ExtArgs> | null
    /**
     * The data needed to update a NutritionGoal.
     */
    data: XOR<NutritionGoalUpdateInput, NutritionGoalUncheckedUpdateInput>
    /**
     * Choose, which NutritionGoal to update.
     */
    where: NutritionGoalWhereUniqueInput
  }

  /**
   * NutritionGoal updateMany
   */
  export type NutritionGoalUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update NutritionGoals.
     */
    data: XOR<NutritionGoalUpdateManyMutationInput, NutritionGoalUncheckedUpdateManyInput>
    /**
     * Filter which NutritionGoals to update
     */
    where?: NutritionGoalWhereInput
  }

  /**
   * NutritionGoal upsert
   */
  export type NutritionGoalUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the NutritionGoal
     */
    select?: NutritionGoalSelect<ExtArgs> | null
    /**
     * The filter to search for the NutritionGoal to update in case it exists.
     */
    where: NutritionGoalWhereUniqueInput
    /**
     * In case the NutritionGoal found by the `where` argument doesn't exist, create a new NutritionGoal with this data.
     */
    create: XOR<NutritionGoalCreateInput, NutritionGoalUncheckedCreateInput>
    /**
     * In case the NutritionGoal was found with the provided `where` argument, update it with this data.
     */
    update: XOR<NutritionGoalUpdateInput, NutritionGoalUncheckedUpdateInput>
  }

  /**
   * NutritionGoal delete
   */
  export type NutritionGoalDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the NutritionGoal
     */
    select?: NutritionGoalSelect<ExtArgs> | null
    /**
     * Filter which NutritionGoal to delete.
     */
    where: NutritionGoalWhereUniqueInput
  }

  /**
   * NutritionGoal deleteMany
   */
  export type NutritionGoalDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which NutritionGoals to delete
     */
    where?: NutritionGoalWhereInput
  }

  /**
   * NutritionGoal without action
   */
  export type NutritionGoalDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the NutritionGoal
     */
    select?: NutritionGoalSelect<ExtArgs> | null
  }


  /**
   * Model BodyMetrics
   */

  export type AggregateBodyMetrics = {
    _count: BodyMetricsCountAggregateOutputType | null
    _avg: BodyMetricsAvgAggregateOutputType | null
    _sum: BodyMetricsSumAggregateOutputType | null
    _min: BodyMetricsMinAggregateOutputType | null
    _max: BodyMetricsMaxAggregateOutputType | null
  }

  export type BodyMetricsAvgAggregateOutputType = {
    weight: number | null
    bodyFat: number | null
    muscleMass: number | null
    bodyWater: number | null
  }

  export type BodyMetricsSumAggregateOutputType = {
    weight: number | null
    bodyFat: number | null
    muscleMass: number | null
    bodyWater: number | null
  }

  export type BodyMetricsMinAggregateOutputType = {
    id: string | null
    userId: string | null
    date: Date | null
    weight: number | null
    bodyFat: number | null
    muscleMass: number | null
    bodyWater: number | null
    notes: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type BodyMetricsMaxAggregateOutputType = {
    id: string | null
    userId: string | null
    date: Date | null
    weight: number | null
    bodyFat: number | null
    muscleMass: number | null
    bodyWater: number | null
    notes: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type BodyMetricsCountAggregateOutputType = {
    id: number
    userId: number
    date: number
    weight: number
    bodyFat: number
    muscleMass: number
    bodyWater: number
    notes: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type BodyMetricsAvgAggregateInputType = {
    weight?: true
    bodyFat?: true
    muscleMass?: true
    bodyWater?: true
  }

  export type BodyMetricsSumAggregateInputType = {
    weight?: true
    bodyFat?: true
    muscleMass?: true
    bodyWater?: true
  }

  export type BodyMetricsMinAggregateInputType = {
    id?: true
    userId?: true
    date?: true
    weight?: true
    bodyFat?: true
    muscleMass?: true
    bodyWater?: true
    notes?: true
    createdAt?: true
    updatedAt?: true
  }

  export type BodyMetricsMaxAggregateInputType = {
    id?: true
    userId?: true
    date?: true
    weight?: true
    bodyFat?: true
    muscleMass?: true
    bodyWater?: true
    notes?: true
    createdAt?: true
    updatedAt?: true
  }

  export type BodyMetricsCountAggregateInputType = {
    id?: true
    userId?: true
    date?: true
    weight?: true
    bodyFat?: true
    muscleMass?: true
    bodyWater?: true
    notes?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type BodyMetricsAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which BodyMetrics to aggregate.
     */
    where?: BodyMetricsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of BodyMetrics to fetch.
     */
    orderBy?: BodyMetricsOrderByWithRelationInput | BodyMetricsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: BodyMetricsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` BodyMetrics from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` BodyMetrics.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned BodyMetrics
    **/
    _count?: true | BodyMetricsCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: BodyMetricsAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: BodyMetricsSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: BodyMetricsMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: BodyMetricsMaxAggregateInputType
  }

  export type GetBodyMetricsAggregateType<T extends BodyMetricsAggregateArgs> = {
        [P in keyof T & keyof AggregateBodyMetrics]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateBodyMetrics[P]>
      : GetScalarType<T[P], AggregateBodyMetrics[P]>
  }




  export type BodyMetricsGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: BodyMetricsWhereInput
    orderBy?: BodyMetricsOrderByWithAggregationInput | BodyMetricsOrderByWithAggregationInput[]
    by: BodyMetricsScalarFieldEnum[] | BodyMetricsScalarFieldEnum
    having?: BodyMetricsScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: BodyMetricsCountAggregateInputType | true
    _avg?: BodyMetricsAvgAggregateInputType
    _sum?: BodyMetricsSumAggregateInputType
    _min?: BodyMetricsMinAggregateInputType
    _max?: BodyMetricsMaxAggregateInputType
  }

  export type BodyMetricsGroupByOutputType = {
    id: string
    userId: string
    date: Date
    weight: number | null
    bodyFat: number | null
    muscleMass: number | null
    bodyWater: number | null
    notes: string | null
    createdAt: Date
    updatedAt: Date
    _count: BodyMetricsCountAggregateOutputType | null
    _avg: BodyMetricsAvgAggregateOutputType | null
    _sum: BodyMetricsSumAggregateOutputType | null
    _min: BodyMetricsMinAggregateOutputType | null
    _max: BodyMetricsMaxAggregateOutputType | null
  }

  type GetBodyMetricsGroupByPayload<T extends BodyMetricsGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<BodyMetricsGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof BodyMetricsGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], BodyMetricsGroupByOutputType[P]>
            : GetScalarType<T[P], BodyMetricsGroupByOutputType[P]>
        }
      >
    >


  export type BodyMetricsSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    userId?: boolean
    date?: boolean
    weight?: boolean
    bodyFat?: boolean
    muscleMass?: boolean
    bodyWater?: boolean
    notes?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["bodyMetrics"]>

  export type BodyMetricsSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    userId?: boolean
    date?: boolean
    weight?: boolean
    bodyFat?: boolean
    muscleMass?: boolean
    bodyWater?: boolean
    notes?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["bodyMetrics"]>

  export type BodyMetricsSelectScalar = {
    id?: boolean
    userId?: boolean
    date?: boolean
    weight?: boolean
    bodyFat?: boolean
    muscleMass?: boolean
    bodyWater?: boolean
    notes?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }


  export type $BodyMetricsPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "BodyMetrics"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: string
      userId: string
      date: Date
      weight: number | null
      bodyFat: number | null
      muscleMass: number | null
      bodyWater: number | null
      notes: string | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["bodyMetrics"]>
    composites: {}
  }

  type BodyMetricsGetPayload<S extends boolean | null | undefined | BodyMetricsDefaultArgs> = $Result.GetResult<Prisma.$BodyMetricsPayload, S>

  type BodyMetricsCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<BodyMetricsFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: BodyMetricsCountAggregateInputType | true
    }

  export interface BodyMetricsDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['BodyMetrics'], meta: { name: 'BodyMetrics' } }
    /**
     * Find zero or one BodyMetrics that matches the filter.
     * @param {BodyMetricsFindUniqueArgs} args - Arguments to find a BodyMetrics
     * @example
     * // Get one BodyMetrics
     * const bodyMetrics = await prisma.bodyMetrics.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends BodyMetricsFindUniqueArgs>(args: SelectSubset<T, BodyMetricsFindUniqueArgs<ExtArgs>>): Prisma__BodyMetricsClient<$Result.GetResult<Prisma.$BodyMetricsPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one BodyMetrics that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {BodyMetricsFindUniqueOrThrowArgs} args - Arguments to find a BodyMetrics
     * @example
     * // Get one BodyMetrics
     * const bodyMetrics = await prisma.bodyMetrics.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends BodyMetricsFindUniqueOrThrowArgs>(args: SelectSubset<T, BodyMetricsFindUniqueOrThrowArgs<ExtArgs>>): Prisma__BodyMetricsClient<$Result.GetResult<Prisma.$BodyMetricsPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first BodyMetrics that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {BodyMetricsFindFirstArgs} args - Arguments to find a BodyMetrics
     * @example
     * // Get one BodyMetrics
     * const bodyMetrics = await prisma.bodyMetrics.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends BodyMetricsFindFirstArgs>(args?: SelectSubset<T, BodyMetricsFindFirstArgs<ExtArgs>>): Prisma__BodyMetricsClient<$Result.GetResult<Prisma.$BodyMetricsPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first BodyMetrics that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {BodyMetricsFindFirstOrThrowArgs} args - Arguments to find a BodyMetrics
     * @example
     * // Get one BodyMetrics
     * const bodyMetrics = await prisma.bodyMetrics.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends BodyMetricsFindFirstOrThrowArgs>(args?: SelectSubset<T, BodyMetricsFindFirstOrThrowArgs<ExtArgs>>): Prisma__BodyMetricsClient<$Result.GetResult<Prisma.$BodyMetricsPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more BodyMetrics that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {BodyMetricsFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all BodyMetrics
     * const bodyMetrics = await prisma.bodyMetrics.findMany()
     * 
     * // Get first 10 BodyMetrics
     * const bodyMetrics = await prisma.bodyMetrics.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const bodyMetricsWithIdOnly = await prisma.bodyMetrics.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends BodyMetricsFindManyArgs>(args?: SelectSubset<T, BodyMetricsFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$BodyMetricsPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a BodyMetrics.
     * @param {BodyMetricsCreateArgs} args - Arguments to create a BodyMetrics.
     * @example
     * // Create one BodyMetrics
     * const BodyMetrics = await prisma.bodyMetrics.create({
     *   data: {
     *     // ... data to create a BodyMetrics
     *   }
     * })
     * 
     */
    create<T extends BodyMetricsCreateArgs>(args: SelectSubset<T, BodyMetricsCreateArgs<ExtArgs>>): Prisma__BodyMetricsClient<$Result.GetResult<Prisma.$BodyMetricsPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many BodyMetrics.
     * @param {BodyMetricsCreateManyArgs} args - Arguments to create many BodyMetrics.
     * @example
     * // Create many BodyMetrics
     * const bodyMetrics = await prisma.bodyMetrics.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends BodyMetricsCreateManyArgs>(args?: SelectSubset<T, BodyMetricsCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many BodyMetrics and returns the data saved in the database.
     * @param {BodyMetricsCreateManyAndReturnArgs} args - Arguments to create many BodyMetrics.
     * @example
     * // Create many BodyMetrics
     * const bodyMetrics = await prisma.bodyMetrics.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many BodyMetrics and only return the `id`
     * const bodyMetricsWithIdOnly = await prisma.bodyMetrics.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends BodyMetricsCreateManyAndReturnArgs>(args?: SelectSubset<T, BodyMetricsCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$BodyMetricsPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a BodyMetrics.
     * @param {BodyMetricsDeleteArgs} args - Arguments to delete one BodyMetrics.
     * @example
     * // Delete one BodyMetrics
     * const BodyMetrics = await prisma.bodyMetrics.delete({
     *   where: {
     *     // ... filter to delete one BodyMetrics
     *   }
     * })
     * 
     */
    delete<T extends BodyMetricsDeleteArgs>(args: SelectSubset<T, BodyMetricsDeleteArgs<ExtArgs>>): Prisma__BodyMetricsClient<$Result.GetResult<Prisma.$BodyMetricsPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one BodyMetrics.
     * @param {BodyMetricsUpdateArgs} args - Arguments to update one BodyMetrics.
     * @example
     * // Update one BodyMetrics
     * const bodyMetrics = await prisma.bodyMetrics.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends BodyMetricsUpdateArgs>(args: SelectSubset<T, BodyMetricsUpdateArgs<ExtArgs>>): Prisma__BodyMetricsClient<$Result.GetResult<Prisma.$BodyMetricsPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more BodyMetrics.
     * @param {BodyMetricsDeleteManyArgs} args - Arguments to filter BodyMetrics to delete.
     * @example
     * // Delete a few BodyMetrics
     * const { count } = await prisma.bodyMetrics.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends BodyMetricsDeleteManyArgs>(args?: SelectSubset<T, BodyMetricsDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more BodyMetrics.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {BodyMetricsUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many BodyMetrics
     * const bodyMetrics = await prisma.bodyMetrics.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends BodyMetricsUpdateManyArgs>(args: SelectSubset<T, BodyMetricsUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one BodyMetrics.
     * @param {BodyMetricsUpsertArgs} args - Arguments to update or create a BodyMetrics.
     * @example
     * // Update or create a BodyMetrics
     * const bodyMetrics = await prisma.bodyMetrics.upsert({
     *   create: {
     *     // ... data to create a BodyMetrics
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the BodyMetrics we want to update
     *   }
     * })
     */
    upsert<T extends BodyMetricsUpsertArgs>(args: SelectSubset<T, BodyMetricsUpsertArgs<ExtArgs>>): Prisma__BodyMetricsClient<$Result.GetResult<Prisma.$BodyMetricsPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of BodyMetrics.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {BodyMetricsCountArgs} args - Arguments to filter BodyMetrics to count.
     * @example
     * // Count the number of BodyMetrics
     * const count = await prisma.bodyMetrics.count({
     *   where: {
     *     // ... the filter for the BodyMetrics we want to count
     *   }
     * })
    **/
    count<T extends BodyMetricsCountArgs>(
      args?: Subset<T, BodyMetricsCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], BodyMetricsCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a BodyMetrics.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {BodyMetricsAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends BodyMetricsAggregateArgs>(args: Subset<T, BodyMetricsAggregateArgs>): Prisma.PrismaPromise<GetBodyMetricsAggregateType<T>>

    /**
     * Group by BodyMetrics.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {BodyMetricsGroupByArgs} args - Group by arguments.
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
      T extends BodyMetricsGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: BodyMetricsGroupByArgs['orderBy'] }
        : { orderBy?: BodyMetricsGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, BodyMetricsGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetBodyMetricsGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the BodyMetrics model
   */
  readonly fields: BodyMetricsFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for BodyMetrics.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__BodyMetricsClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
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
   * Fields of the BodyMetrics model
   */ 
  interface BodyMetricsFieldRefs {
    readonly id: FieldRef<"BodyMetrics", 'String'>
    readonly userId: FieldRef<"BodyMetrics", 'String'>
    readonly date: FieldRef<"BodyMetrics", 'DateTime'>
    readonly weight: FieldRef<"BodyMetrics", 'Float'>
    readonly bodyFat: FieldRef<"BodyMetrics", 'Float'>
    readonly muscleMass: FieldRef<"BodyMetrics", 'Float'>
    readonly bodyWater: FieldRef<"BodyMetrics", 'Float'>
    readonly notes: FieldRef<"BodyMetrics", 'String'>
    readonly createdAt: FieldRef<"BodyMetrics", 'DateTime'>
    readonly updatedAt: FieldRef<"BodyMetrics", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * BodyMetrics findUnique
   */
  export type BodyMetricsFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the BodyMetrics
     */
    select?: BodyMetricsSelect<ExtArgs> | null
    /**
     * Filter, which BodyMetrics to fetch.
     */
    where: BodyMetricsWhereUniqueInput
  }

  /**
   * BodyMetrics findUniqueOrThrow
   */
  export type BodyMetricsFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the BodyMetrics
     */
    select?: BodyMetricsSelect<ExtArgs> | null
    /**
     * Filter, which BodyMetrics to fetch.
     */
    where: BodyMetricsWhereUniqueInput
  }

  /**
   * BodyMetrics findFirst
   */
  export type BodyMetricsFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the BodyMetrics
     */
    select?: BodyMetricsSelect<ExtArgs> | null
    /**
     * Filter, which BodyMetrics to fetch.
     */
    where?: BodyMetricsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of BodyMetrics to fetch.
     */
    orderBy?: BodyMetricsOrderByWithRelationInput | BodyMetricsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for BodyMetrics.
     */
    cursor?: BodyMetricsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` BodyMetrics from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` BodyMetrics.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of BodyMetrics.
     */
    distinct?: BodyMetricsScalarFieldEnum | BodyMetricsScalarFieldEnum[]
  }

  /**
   * BodyMetrics findFirstOrThrow
   */
  export type BodyMetricsFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the BodyMetrics
     */
    select?: BodyMetricsSelect<ExtArgs> | null
    /**
     * Filter, which BodyMetrics to fetch.
     */
    where?: BodyMetricsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of BodyMetrics to fetch.
     */
    orderBy?: BodyMetricsOrderByWithRelationInput | BodyMetricsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for BodyMetrics.
     */
    cursor?: BodyMetricsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` BodyMetrics from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` BodyMetrics.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of BodyMetrics.
     */
    distinct?: BodyMetricsScalarFieldEnum | BodyMetricsScalarFieldEnum[]
  }

  /**
   * BodyMetrics findMany
   */
  export type BodyMetricsFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the BodyMetrics
     */
    select?: BodyMetricsSelect<ExtArgs> | null
    /**
     * Filter, which BodyMetrics to fetch.
     */
    where?: BodyMetricsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of BodyMetrics to fetch.
     */
    orderBy?: BodyMetricsOrderByWithRelationInput | BodyMetricsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing BodyMetrics.
     */
    cursor?: BodyMetricsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` BodyMetrics from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` BodyMetrics.
     */
    skip?: number
    distinct?: BodyMetricsScalarFieldEnum | BodyMetricsScalarFieldEnum[]
  }

  /**
   * BodyMetrics create
   */
  export type BodyMetricsCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the BodyMetrics
     */
    select?: BodyMetricsSelect<ExtArgs> | null
    /**
     * The data needed to create a BodyMetrics.
     */
    data: XOR<BodyMetricsCreateInput, BodyMetricsUncheckedCreateInput>
  }

  /**
   * BodyMetrics createMany
   */
  export type BodyMetricsCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many BodyMetrics.
     */
    data: BodyMetricsCreateManyInput | BodyMetricsCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * BodyMetrics createManyAndReturn
   */
  export type BodyMetricsCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the BodyMetrics
     */
    select?: BodyMetricsSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many BodyMetrics.
     */
    data: BodyMetricsCreateManyInput | BodyMetricsCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * BodyMetrics update
   */
  export type BodyMetricsUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the BodyMetrics
     */
    select?: BodyMetricsSelect<ExtArgs> | null
    /**
     * The data needed to update a BodyMetrics.
     */
    data: XOR<BodyMetricsUpdateInput, BodyMetricsUncheckedUpdateInput>
    /**
     * Choose, which BodyMetrics to update.
     */
    where: BodyMetricsWhereUniqueInput
  }

  /**
   * BodyMetrics updateMany
   */
  export type BodyMetricsUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update BodyMetrics.
     */
    data: XOR<BodyMetricsUpdateManyMutationInput, BodyMetricsUncheckedUpdateManyInput>
    /**
     * Filter which BodyMetrics to update
     */
    where?: BodyMetricsWhereInput
  }

  /**
   * BodyMetrics upsert
   */
  export type BodyMetricsUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the BodyMetrics
     */
    select?: BodyMetricsSelect<ExtArgs> | null
    /**
     * The filter to search for the BodyMetrics to update in case it exists.
     */
    where: BodyMetricsWhereUniqueInput
    /**
     * In case the BodyMetrics found by the `where` argument doesn't exist, create a new BodyMetrics with this data.
     */
    create: XOR<BodyMetricsCreateInput, BodyMetricsUncheckedCreateInput>
    /**
     * In case the BodyMetrics was found with the provided `where` argument, update it with this data.
     */
    update: XOR<BodyMetricsUpdateInput, BodyMetricsUncheckedUpdateInput>
  }

  /**
   * BodyMetrics delete
   */
  export type BodyMetricsDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the BodyMetrics
     */
    select?: BodyMetricsSelect<ExtArgs> | null
    /**
     * Filter which BodyMetrics to delete.
     */
    where: BodyMetricsWhereUniqueInput
  }

  /**
   * BodyMetrics deleteMany
   */
  export type BodyMetricsDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which BodyMetrics to delete
     */
    where?: BodyMetricsWhereInput
  }

  /**
   * BodyMetrics without action
   */
  export type BodyMetricsDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the BodyMetrics
     */
    select?: BodyMetricsSelect<ExtArgs> | null
  }


  /**
   * Model WorkoutProgram
   */

  export type AggregateWorkoutProgram = {
    _count: WorkoutProgramCountAggregateOutputType | null
    _min: WorkoutProgramMinAggregateOutputType | null
    _max: WorkoutProgramMaxAggregateOutputType | null
  }

  export type WorkoutProgramMinAggregateOutputType = {
    id: string | null
    userId: string | null
    name: string | null
    description: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type WorkoutProgramMaxAggregateOutputType = {
    id: string | null
    userId: string | null
    name: string | null
    description: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type WorkoutProgramCountAggregateOutputType = {
    id: number
    userId: number
    name: number
    description: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type WorkoutProgramMinAggregateInputType = {
    id?: true
    userId?: true
    name?: true
    description?: true
    createdAt?: true
    updatedAt?: true
  }

  export type WorkoutProgramMaxAggregateInputType = {
    id?: true
    userId?: true
    name?: true
    description?: true
    createdAt?: true
    updatedAt?: true
  }

  export type WorkoutProgramCountAggregateInputType = {
    id?: true
    userId?: true
    name?: true
    description?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type WorkoutProgramAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which WorkoutProgram to aggregate.
     */
    where?: WorkoutProgramWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of WorkoutPrograms to fetch.
     */
    orderBy?: WorkoutProgramOrderByWithRelationInput | WorkoutProgramOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: WorkoutProgramWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` WorkoutPrograms from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` WorkoutPrograms.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned WorkoutPrograms
    **/
    _count?: true | WorkoutProgramCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: WorkoutProgramMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: WorkoutProgramMaxAggregateInputType
  }

  export type GetWorkoutProgramAggregateType<T extends WorkoutProgramAggregateArgs> = {
        [P in keyof T & keyof AggregateWorkoutProgram]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateWorkoutProgram[P]>
      : GetScalarType<T[P], AggregateWorkoutProgram[P]>
  }




  export type WorkoutProgramGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: WorkoutProgramWhereInput
    orderBy?: WorkoutProgramOrderByWithAggregationInput | WorkoutProgramOrderByWithAggregationInput[]
    by: WorkoutProgramScalarFieldEnum[] | WorkoutProgramScalarFieldEnum
    having?: WorkoutProgramScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: WorkoutProgramCountAggregateInputType | true
    _min?: WorkoutProgramMinAggregateInputType
    _max?: WorkoutProgramMaxAggregateInputType
  }

  export type WorkoutProgramGroupByOutputType = {
    id: string
    userId: string
    name: string
    description: string | null
    createdAt: Date
    updatedAt: Date
    _count: WorkoutProgramCountAggregateOutputType | null
    _min: WorkoutProgramMinAggregateOutputType | null
    _max: WorkoutProgramMaxAggregateOutputType | null
  }

  type GetWorkoutProgramGroupByPayload<T extends WorkoutProgramGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<WorkoutProgramGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof WorkoutProgramGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], WorkoutProgramGroupByOutputType[P]>
            : GetScalarType<T[P], WorkoutProgramGroupByOutputType[P]>
        }
      >
    >


  export type WorkoutProgramSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    userId?: boolean
    name?: boolean
    description?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    days?: boolean | WorkoutProgram$daysArgs<ExtArgs>
    _count?: boolean | WorkoutProgramCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["workoutProgram"]>

  export type WorkoutProgramSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    userId?: boolean
    name?: boolean
    description?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["workoutProgram"]>

  export type WorkoutProgramSelectScalar = {
    id?: boolean
    userId?: boolean
    name?: boolean
    description?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type WorkoutProgramInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    days?: boolean | WorkoutProgram$daysArgs<ExtArgs>
    _count?: boolean | WorkoutProgramCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type WorkoutProgramIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {}

  export type $WorkoutProgramPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "WorkoutProgram"
    objects: {
      days: Prisma.$WorkoutProgramDayPayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      userId: string
      name: string
      description: string | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["workoutProgram"]>
    composites: {}
  }

  type WorkoutProgramGetPayload<S extends boolean | null | undefined | WorkoutProgramDefaultArgs> = $Result.GetResult<Prisma.$WorkoutProgramPayload, S>

  type WorkoutProgramCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<WorkoutProgramFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: WorkoutProgramCountAggregateInputType | true
    }

  export interface WorkoutProgramDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['WorkoutProgram'], meta: { name: 'WorkoutProgram' } }
    /**
     * Find zero or one WorkoutProgram that matches the filter.
     * @param {WorkoutProgramFindUniqueArgs} args - Arguments to find a WorkoutProgram
     * @example
     * // Get one WorkoutProgram
     * const workoutProgram = await prisma.workoutProgram.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends WorkoutProgramFindUniqueArgs>(args: SelectSubset<T, WorkoutProgramFindUniqueArgs<ExtArgs>>): Prisma__WorkoutProgramClient<$Result.GetResult<Prisma.$WorkoutProgramPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one WorkoutProgram that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {WorkoutProgramFindUniqueOrThrowArgs} args - Arguments to find a WorkoutProgram
     * @example
     * // Get one WorkoutProgram
     * const workoutProgram = await prisma.workoutProgram.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends WorkoutProgramFindUniqueOrThrowArgs>(args: SelectSubset<T, WorkoutProgramFindUniqueOrThrowArgs<ExtArgs>>): Prisma__WorkoutProgramClient<$Result.GetResult<Prisma.$WorkoutProgramPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first WorkoutProgram that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutProgramFindFirstArgs} args - Arguments to find a WorkoutProgram
     * @example
     * // Get one WorkoutProgram
     * const workoutProgram = await prisma.workoutProgram.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends WorkoutProgramFindFirstArgs>(args?: SelectSubset<T, WorkoutProgramFindFirstArgs<ExtArgs>>): Prisma__WorkoutProgramClient<$Result.GetResult<Prisma.$WorkoutProgramPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first WorkoutProgram that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutProgramFindFirstOrThrowArgs} args - Arguments to find a WorkoutProgram
     * @example
     * // Get one WorkoutProgram
     * const workoutProgram = await prisma.workoutProgram.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends WorkoutProgramFindFirstOrThrowArgs>(args?: SelectSubset<T, WorkoutProgramFindFirstOrThrowArgs<ExtArgs>>): Prisma__WorkoutProgramClient<$Result.GetResult<Prisma.$WorkoutProgramPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more WorkoutPrograms that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutProgramFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all WorkoutPrograms
     * const workoutPrograms = await prisma.workoutProgram.findMany()
     * 
     * // Get first 10 WorkoutPrograms
     * const workoutPrograms = await prisma.workoutProgram.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const workoutProgramWithIdOnly = await prisma.workoutProgram.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends WorkoutProgramFindManyArgs>(args?: SelectSubset<T, WorkoutProgramFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$WorkoutProgramPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a WorkoutProgram.
     * @param {WorkoutProgramCreateArgs} args - Arguments to create a WorkoutProgram.
     * @example
     * // Create one WorkoutProgram
     * const WorkoutProgram = await prisma.workoutProgram.create({
     *   data: {
     *     // ... data to create a WorkoutProgram
     *   }
     * })
     * 
     */
    create<T extends WorkoutProgramCreateArgs>(args: SelectSubset<T, WorkoutProgramCreateArgs<ExtArgs>>): Prisma__WorkoutProgramClient<$Result.GetResult<Prisma.$WorkoutProgramPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many WorkoutPrograms.
     * @param {WorkoutProgramCreateManyArgs} args - Arguments to create many WorkoutPrograms.
     * @example
     * // Create many WorkoutPrograms
     * const workoutProgram = await prisma.workoutProgram.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends WorkoutProgramCreateManyArgs>(args?: SelectSubset<T, WorkoutProgramCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many WorkoutPrograms and returns the data saved in the database.
     * @param {WorkoutProgramCreateManyAndReturnArgs} args - Arguments to create many WorkoutPrograms.
     * @example
     * // Create many WorkoutPrograms
     * const workoutProgram = await prisma.workoutProgram.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many WorkoutPrograms and only return the `id`
     * const workoutProgramWithIdOnly = await prisma.workoutProgram.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends WorkoutProgramCreateManyAndReturnArgs>(args?: SelectSubset<T, WorkoutProgramCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$WorkoutProgramPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a WorkoutProgram.
     * @param {WorkoutProgramDeleteArgs} args - Arguments to delete one WorkoutProgram.
     * @example
     * // Delete one WorkoutProgram
     * const WorkoutProgram = await prisma.workoutProgram.delete({
     *   where: {
     *     // ... filter to delete one WorkoutProgram
     *   }
     * })
     * 
     */
    delete<T extends WorkoutProgramDeleteArgs>(args: SelectSubset<T, WorkoutProgramDeleteArgs<ExtArgs>>): Prisma__WorkoutProgramClient<$Result.GetResult<Prisma.$WorkoutProgramPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one WorkoutProgram.
     * @param {WorkoutProgramUpdateArgs} args - Arguments to update one WorkoutProgram.
     * @example
     * // Update one WorkoutProgram
     * const workoutProgram = await prisma.workoutProgram.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends WorkoutProgramUpdateArgs>(args: SelectSubset<T, WorkoutProgramUpdateArgs<ExtArgs>>): Prisma__WorkoutProgramClient<$Result.GetResult<Prisma.$WorkoutProgramPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more WorkoutPrograms.
     * @param {WorkoutProgramDeleteManyArgs} args - Arguments to filter WorkoutPrograms to delete.
     * @example
     * // Delete a few WorkoutPrograms
     * const { count } = await prisma.workoutProgram.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends WorkoutProgramDeleteManyArgs>(args?: SelectSubset<T, WorkoutProgramDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more WorkoutPrograms.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutProgramUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many WorkoutPrograms
     * const workoutProgram = await prisma.workoutProgram.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends WorkoutProgramUpdateManyArgs>(args: SelectSubset<T, WorkoutProgramUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one WorkoutProgram.
     * @param {WorkoutProgramUpsertArgs} args - Arguments to update or create a WorkoutProgram.
     * @example
     * // Update or create a WorkoutProgram
     * const workoutProgram = await prisma.workoutProgram.upsert({
     *   create: {
     *     // ... data to create a WorkoutProgram
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the WorkoutProgram we want to update
     *   }
     * })
     */
    upsert<T extends WorkoutProgramUpsertArgs>(args: SelectSubset<T, WorkoutProgramUpsertArgs<ExtArgs>>): Prisma__WorkoutProgramClient<$Result.GetResult<Prisma.$WorkoutProgramPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of WorkoutPrograms.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutProgramCountArgs} args - Arguments to filter WorkoutPrograms to count.
     * @example
     * // Count the number of WorkoutPrograms
     * const count = await prisma.workoutProgram.count({
     *   where: {
     *     // ... the filter for the WorkoutPrograms we want to count
     *   }
     * })
    **/
    count<T extends WorkoutProgramCountArgs>(
      args?: Subset<T, WorkoutProgramCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], WorkoutProgramCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a WorkoutProgram.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutProgramAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends WorkoutProgramAggregateArgs>(args: Subset<T, WorkoutProgramAggregateArgs>): Prisma.PrismaPromise<GetWorkoutProgramAggregateType<T>>

    /**
     * Group by WorkoutProgram.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutProgramGroupByArgs} args - Group by arguments.
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
      T extends WorkoutProgramGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: WorkoutProgramGroupByArgs['orderBy'] }
        : { orderBy?: WorkoutProgramGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, WorkoutProgramGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetWorkoutProgramGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the WorkoutProgram model
   */
  readonly fields: WorkoutProgramFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for WorkoutProgram.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__WorkoutProgramClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    days<T extends WorkoutProgram$daysArgs<ExtArgs> = {}>(args?: Subset<T, WorkoutProgram$daysArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$WorkoutProgramDayPayload<ExtArgs>, T, "findMany"> | Null>
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
   * Fields of the WorkoutProgram model
   */ 
  interface WorkoutProgramFieldRefs {
    readonly id: FieldRef<"WorkoutProgram", 'String'>
    readonly userId: FieldRef<"WorkoutProgram", 'String'>
    readonly name: FieldRef<"WorkoutProgram", 'String'>
    readonly description: FieldRef<"WorkoutProgram", 'String'>
    readonly createdAt: FieldRef<"WorkoutProgram", 'DateTime'>
    readonly updatedAt: FieldRef<"WorkoutProgram", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * WorkoutProgram findUnique
   */
  export type WorkoutProgramFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutProgram
     */
    select?: WorkoutProgramSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutProgramInclude<ExtArgs> | null
    /**
     * Filter, which WorkoutProgram to fetch.
     */
    where: WorkoutProgramWhereUniqueInput
  }

  /**
   * WorkoutProgram findUniqueOrThrow
   */
  export type WorkoutProgramFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutProgram
     */
    select?: WorkoutProgramSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutProgramInclude<ExtArgs> | null
    /**
     * Filter, which WorkoutProgram to fetch.
     */
    where: WorkoutProgramWhereUniqueInput
  }

  /**
   * WorkoutProgram findFirst
   */
  export type WorkoutProgramFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutProgram
     */
    select?: WorkoutProgramSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutProgramInclude<ExtArgs> | null
    /**
     * Filter, which WorkoutProgram to fetch.
     */
    where?: WorkoutProgramWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of WorkoutPrograms to fetch.
     */
    orderBy?: WorkoutProgramOrderByWithRelationInput | WorkoutProgramOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for WorkoutPrograms.
     */
    cursor?: WorkoutProgramWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` WorkoutPrograms from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` WorkoutPrograms.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of WorkoutPrograms.
     */
    distinct?: WorkoutProgramScalarFieldEnum | WorkoutProgramScalarFieldEnum[]
  }

  /**
   * WorkoutProgram findFirstOrThrow
   */
  export type WorkoutProgramFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutProgram
     */
    select?: WorkoutProgramSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutProgramInclude<ExtArgs> | null
    /**
     * Filter, which WorkoutProgram to fetch.
     */
    where?: WorkoutProgramWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of WorkoutPrograms to fetch.
     */
    orderBy?: WorkoutProgramOrderByWithRelationInput | WorkoutProgramOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for WorkoutPrograms.
     */
    cursor?: WorkoutProgramWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` WorkoutPrograms from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` WorkoutPrograms.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of WorkoutPrograms.
     */
    distinct?: WorkoutProgramScalarFieldEnum | WorkoutProgramScalarFieldEnum[]
  }

  /**
   * WorkoutProgram findMany
   */
  export type WorkoutProgramFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutProgram
     */
    select?: WorkoutProgramSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutProgramInclude<ExtArgs> | null
    /**
     * Filter, which WorkoutPrograms to fetch.
     */
    where?: WorkoutProgramWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of WorkoutPrograms to fetch.
     */
    orderBy?: WorkoutProgramOrderByWithRelationInput | WorkoutProgramOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing WorkoutPrograms.
     */
    cursor?: WorkoutProgramWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` WorkoutPrograms from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` WorkoutPrograms.
     */
    skip?: number
    distinct?: WorkoutProgramScalarFieldEnum | WorkoutProgramScalarFieldEnum[]
  }

  /**
   * WorkoutProgram create
   */
  export type WorkoutProgramCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutProgram
     */
    select?: WorkoutProgramSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutProgramInclude<ExtArgs> | null
    /**
     * The data needed to create a WorkoutProgram.
     */
    data: XOR<WorkoutProgramCreateInput, WorkoutProgramUncheckedCreateInput>
  }

  /**
   * WorkoutProgram createMany
   */
  export type WorkoutProgramCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many WorkoutPrograms.
     */
    data: WorkoutProgramCreateManyInput | WorkoutProgramCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * WorkoutProgram createManyAndReturn
   */
  export type WorkoutProgramCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutProgram
     */
    select?: WorkoutProgramSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many WorkoutPrograms.
     */
    data: WorkoutProgramCreateManyInput | WorkoutProgramCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * WorkoutProgram update
   */
  export type WorkoutProgramUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutProgram
     */
    select?: WorkoutProgramSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutProgramInclude<ExtArgs> | null
    /**
     * The data needed to update a WorkoutProgram.
     */
    data: XOR<WorkoutProgramUpdateInput, WorkoutProgramUncheckedUpdateInput>
    /**
     * Choose, which WorkoutProgram to update.
     */
    where: WorkoutProgramWhereUniqueInput
  }

  /**
   * WorkoutProgram updateMany
   */
  export type WorkoutProgramUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update WorkoutPrograms.
     */
    data: XOR<WorkoutProgramUpdateManyMutationInput, WorkoutProgramUncheckedUpdateManyInput>
    /**
     * Filter which WorkoutPrograms to update
     */
    where?: WorkoutProgramWhereInput
  }

  /**
   * WorkoutProgram upsert
   */
  export type WorkoutProgramUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutProgram
     */
    select?: WorkoutProgramSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutProgramInclude<ExtArgs> | null
    /**
     * The filter to search for the WorkoutProgram to update in case it exists.
     */
    where: WorkoutProgramWhereUniqueInput
    /**
     * In case the WorkoutProgram found by the `where` argument doesn't exist, create a new WorkoutProgram with this data.
     */
    create: XOR<WorkoutProgramCreateInput, WorkoutProgramUncheckedCreateInput>
    /**
     * In case the WorkoutProgram was found with the provided `where` argument, update it with this data.
     */
    update: XOR<WorkoutProgramUpdateInput, WorkoutProgramUncheckedUpdateInput>
  }

  /**
   * WorkoutProgram delete
   */
  export type WorkoutProgramDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutProgram
     */
    select?: WorkoutProgramSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutProgramInclude<ExtArgs> | null
    /**
     * Filter which WorkoutProgram to delete.
     */
    where: WorkoutProgramWhereUniqueInput
  }

  /**
   * WorkoutProgram deleteMany
   */
  export type WorkoutProgramDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which WorkoutPrograms to delete
     */
    where?: WorkoutProgramWhereInput
  }

  /**
   * WorkoutProgram.days
   */
  export type WorkoutProgram$daysArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutProgramDay
     */
    select?: WorkoutProgramDaySelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutProgramDayInclude<ExtArgs> | null
    where?: WorkoutProgramDayWhereInput
    orderBy?: WorkoutProgramDayOrderByWithRelationInput | WorkoutProgramDayOrderByWithRelationInput[]
    cursor?: WorkoutProgramDayWhereUniqueInput
    take?: number
    skip?: number
    distinct?: WorkoutProgramDayScalarFieldEnum | WorkoutProgramDayScalarFieldEnum[]
  }

  /**
   * WorkoutProgram without action
   */
  export type WorkoutProgramDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutProgram
     */
    select?: WorkoutProgramSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutProgramInclude<ExtArgs> | null
  }


  /**
   * Model WorkoutProgramDay
   */

  export type AggregateWorkoutProgramDay = {
    _count: WorkoutProgramDayCountAggregateOutputType | null
    _avg: WorkoutProgramDayAvgAggregateOutputType | null
    _sum: WorkoutProgramDaySumAggregateOutputType | null
    _min: WorkoutProgramDayMinAggregateOutputType | null
    _max: WorkoutProgramDayMaxAggregateOutputType | null
  }

  export type WorkoutProgramDayAvgAggregateOutputType = {
    dayNumber: number | null
    duration: number | null
  }

  export type WorkoutProgramDaySumAggregateOutputType = {
    dayNumber: number | null
    duration: number | null
  }

  export type WorkoutProgramDayMinAggregateOutputType = {
    id: string | null
    programId: string | null
    dayNumber: number | null
    title: string | null
    description: string | null
    duration: number | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type WorkoutProgramDayMaxAggregateOutputType = {
    id: string | null
    programId: string | null
    dayNumber: number | null
    title: string | null
    description: string | null
    duration: number | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type WorkoutProgramDayCountAggregateOutputType = {
    id: number
    programId: number
    dayNumber: number
    title: number
    description: number
    duration: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type WorkoutProgramDayAvgAggregateInputType = {
    dayNumber?: true
    duration?: true
  }

  export type WorkoutProgramDaySumAggregateInputType = {
    dayNumber?: true
    duration?: true
  }

  export type WorkoutProgramDayMinAggregateInputType = {
    id?: true
    programId?: true
    dayNumber?: true
    title?: true
    description?: true
    duration?: true
    createdAt?: true
    updatedAt?: true
  }

  export type WorkoutProgramDayMaxAggregateInputType = {
    id?: true
    programId?: true
    dayNumber?: true
    title?: true
    description?: true
    duration?: true
    createdAt?: true
    updatedAt?: true
  }

  export type WorkoutProgramDayCountAggregateInputType = {
    id?: true
    programId?: true
    dayNumber?: true
    title?: true
    description?: true
    duration?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type WorkoutProgramDayAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which WorkoutProgramDay to aggregate.
     */
    where?: WorkoutProgramDayWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of WorkoutProgramDays to fetch.
     */
    orderBy?: WorkoutProgramDayOrderByWithRelationInput | WorkoutProgramDayOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: WorkoutProgramDayWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` WorkoutProgramDays from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` WorkoutProgramDays.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned WorkoutProgramDays
    **/
    _count?: true | WorkoutProgramDayCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: WorkoutProgramDayAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: WorkoutProgramDaySumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: WorkoutProgramDayMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: WorkoutProgramDayMaxAggregateInputType
  }

  export type GetWorkoutProgramDayAggregateType<T extends WorkoutProgramDayAggregateArgs> = {
        [P in keyof T & keyof AggregateWorkoutProgramDay]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateWorkoutProgramDay[P]>
      : GetScalarType<T[P], AggregateWorkoutProgramDay[P]>
  }




  export type WorkoutProgramDayGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: WorkoutProgramDayWhereInput
    orderBy?: WorkoutProgramDayOrderByWithAggregationInput | WorkoutProgramDayOrderByWithAggregationInput[]
    by: WorkoutProgramDayScalarFieldEnum[] | WorkoutProgramDayScalarFieldEnum
    having?: WorkoutProgramDayScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: WorkoutProgramDayCountAggregateInputType | true
    _avg?: WorkoutProgramDayAvgAggregateInputType
    _sum?: WorkoutProgramDaySumAggregateInputType
    _min?: WorkoutProgramDayMinAggregateInputType
    _max?: WorkoutProgramDayMaxAggregateInputType
  }

  export type WorkoutProgramDayGroupByOutputType = {
    id: string
    programId: string
    dayNumber: number
    title: string
    description: string | null
    duration: number | null
    createdAt: Date
    updatedAt: Date
    _count: WorkoutProgramDayCountAggregateOutputType | null
    _avg: WorkoutProgramDayAvgAggregateOutputType | null
    _sum: WorkoutProgramDaySumAggregateOutputType | null
    _min: WorkoutProgramDayMinAggregateOutputType | null
    _max: WorkoutProgramDayMaxAggregateOutputType | null
  }

  type GetWorkoutProgramDayGroupByPayload<T extends WorkoutProgramDayGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<WorkoutProgramDayGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof WorkoutProgramDayGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], WorkoutProgramDayGroupByOutputType[P]>
            : GetScalarType<T[P], WorkoutProgramDayGroupByOutputType[P]>
        }
      >
    >


  export type WorkoutProgramDaySelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    programId?: boolean
    dayNumber?: boolean
    title?: boolean
    description?: boolean
    duration?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    program?: boolean | WorkoutProgramDefaultArgs<ExtArgs>
    exercises?: boolean | WorkoutProgramDay$exercisesArgs<ExtArgs>
    schedules?: boolean | WorkoutProgramDay$schedulesArgs<ExtArgs>
    _count?: boolean | WorkoutProgramDayCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["workoutProgramDay"]>

  export type WorkoutProgramDaySelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    programId?: boolean
    dayNumber?: boolean
    title?: boolean
    description?: boolean
    duration?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    program?: boolean | WorkoutProgramDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["workoutProgramDay"]>

  export type WorkoutProgramDaySelectScalar = {
    id?: boolean
    programId?: boolean
    dayNumber?: boolean
    title?: boolean
    description?: boolean
    duration?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type WorkoutProgramDayInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    program?: boolean | WorkoutProgramDefaultArgs<ExtArgs>
    exercises?: boolean | WorkoutProgramDay$exercisesArgs<ExtArgs>
    schedules?: boolean | WorkoutProgramDay$schedulesArgs<ExtArgs>
    _count?: boolean | WorkoutProgramDayCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type WorkoutProgramDayIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    program?: boolean | WorkoutProgramDefaultArgs<ExtArgs>
  }

  export type $WorkoutProgramDayPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "WorkoutProgramDay"
    objects: {
      program: Prisma.$WorkoutProgramPayload<ExtArgs>
      exercises: Prisma.$WorkoutProgramExercisePayload<ExtArgs>[]
      schedules: Prisma.$WorkoutSchedulePayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      programId: string
      dayNumber: number
      title: string
      description: string | null
      duration: number | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["workoutProgramDay"]>
    composites: {}
  }

  type WorkoutProgramDayGetPayload<S extends boolean | null | undefined | WorkoutProgramDayDefaultArgs> = $Result.GetResult<Prisma.$WorkoutProgramDayPayload, S>

  type WorkoutProgramDayCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<WorkoutProgramDayFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: WorkoutProgramDayCountAggregateInputType | true
    }

  export interface WorkoutProgramDayDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['WorkoutProgramDay'], meta: { name: 'WorkoutProgramDay' } }
    /**
     * Find zero or one WorkoutProgramDay that matches the filter.
     * @param {WorkoutProgramDayFindUniqueArgs} args - Arguments to find a WorkoutProgramDay
     * @example
     * // Get one WorkoutProgramDay
     * const workoutProgramDay = await prisma.workoutProgramDay.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends WorkoutProgramDayFindUniqueArgs>(args: SelectSubset<T, WorkoutProgramDayFindUniqueArgs<ExtArgs>>): Prisma__WorkoutProgramDayClient<$Result.GetResult<Prisma.$WorkoutProgramDayPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one WorkoutProgramDay that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {WorkoutProgramDayFindUniqueOrThrowArgs} args - Arguments to find a WorkoutProgramDay
     * @example
     * // Get one WorkoutProgramDay
     * const workoutProgramDay = await prisma.workoutProgramDay.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends WorkoutProgramDayFindUniqueOrThrowArgs>(args: SelectSubset<T, WorkoutProgramDayFindUniqueOrThrowArgs<ExtArgs>>): Prisma__WorkoutProgramDayClient<$Result.GetResult<Prisma.$WorkoutProgramDayPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first WorkoutProgramDay that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutProgramDayFindFirstArgs} args - Arguments to find a WorkoutProgramDay
     * @example
     * // Get one WorkoutProgramDay
     * const workoutProgramDay = await prisma.workoutProgramDay.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends WorkoutProgramDayFindFirstArgs>(args?: SelectSubset<T, WorkoutProgramDayFindFirstArgs<ExtArgs>>): Prisma__WorkoutProgramDayClient<$Result.GetResult<Prisma.$WorkoutProgramDayPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first WorkoutProgramDay that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutProgramDayFindFirstOrThrowArgs} args - Arguments to find a WorkoutProgramDay
     * @example
     * // Get one WorkoutProgramDay
     * const workoutProgramDay = await prisma.workoutProgramDay.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends WorkoutProgramDayFindFirstOrThrowArgs>(args?: SelectSubset<T, WorkoutProgramDayFindFirstOrThrowArgs<ExtArgs>>): Prisma__WorkoutProgramDayClient<$Result.GetResult<Prisma.$WorkoutProgramDayPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more WorkoutProgramDays that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutProgramDayFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all WorkoutProgramDays
     * const workoutProgramDays = await prisma.workoutProgramDay.findMany()
     * 
     * // Get first 10 WorkoutProgramDays
     * const workoutProgramDays = await prisma.workoutProgramDay.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const workoutProgramDayWithIdOnly = await prisma.workoutProgramDay.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends WorkoutProgramDayFindManyArgs>(args?: SelectSubset<T, WorkoutProgramDayFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$WorkoutProgramDayPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a WorkoutProgramDay.
     * @param {WorkoutProgramDayCreateArgs} args - Arguments to create a WorkoutProgramDay.
     * @example
     * // Create one WorkoutProgramDay
     * const WorkoutProgramDay = await prisma.workoutProgramDay.create({
     *   data: {
     *     // ... data to create a WorkoutProgramDay
     *   }
     * })
     * 
     */
    create<T extends WorkoutProgramDayCreateArgs>(args: SelectSubset<T, WorkoutProgramDayCreateArgs<ExtArgs>>): Prisma__WorkoutProgramDayClient<$Result.GetResult<Prisma.$WorkoutProgramDayPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many WorkoutProgramDays.
     * @param {WorkoutProgramDayCreateManyArgs} args - Arguments to create many WorkoutProgramDays.
     * @example
     * // Create many WorkoutProgramDays
     * const workoutProgramDay = await prisma.workoutProgramDay.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends WorkoutProgramDayCreateManyArgs>(args?: SelectSubset<T, WorkoutProgramDayCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many WorkoutProgramDays and returns the data saved in the database.
     * @param {WorkoutProgramDayCreateManyAndReturnArgs} args - Arguments to create many WorkoutProgramDays.
     * @example
     * // Create many WorkoutProgramDays
     * const workoutProgramDay = await prisma.workoutProgramDay.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many WorkoutProgramDays and only return the `id`
     * const workoutProgramDayWithIdOnly = await prisma.workoutProgramDay.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends WorkoutProgramDayCreateManyAndReturnArgs>(args?: SelectSubset<T, WorkoutProgramDayCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$WorkoutProgramDayPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a WorkoutProgramDay.
     * @param {WorkoutProgramDayDeleteArgs} args - Arguments to delete one WorkoutProgramDay.
     * @example
     * // Delete one WorkoutProgramDay
     * const WorkoutProgramDay = await prisma.workoutProgramDay.delete({
     *   where: {
     *     // ... filter to delete one WorkoutProgramDay
     *   }
     * })
     * 
     */
    delete<T extends WorkoutProgramDayDeleteArgs>(args: SelectSubset<T, WorkoutProgramDayDeleteArgs<ExtArgs>>): Prisma__WorkoutProgramDayClient<$Result.GetResult<Prisma.$WorkoutProgramDayPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one WorkoutProgramDay.
     * @param {WorkoutProgramDayUpdateArgs} args - Arguments to update one WorkoutProgramDay.
     * @example
     * // Update one WorkoutProgramDay
     * const workoutProgramDay = await prisma.workoutProgramDay.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends WorkoutProgramDayUpdateArgs>(args: SelectSubset<T, WorkoutProgramDayUpdateArgs<ExtArgs>>): Prisma__WorkoutProgramDayClient<$Result.GetResult<Prisma.$WorkoutProgramDayPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more WorkoutProgramDays.
     * @param {WorkoutProgramDayDeleteManyArgs} args - Arguments to filter WorkoutProgramDays to delete.
     * @example
     * // Delete a few WorkoutProgramDays
     * const { count } = await prisma.workoutProgramDay.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends WorkoutProgramDayDeleteManyArgs>(args?: SelectSubset<T, WorkoutProgramDayDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more WorkoutProgramDays.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutProgramDayUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many WorkoutProgramDays
     * const workoutProgramDay = await prisma.workoutProgramDay.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends WorkoutProgramDayUpdateManyArgs>(args: SelectSubset<T, WorkoutProgramDayUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one WorkoutProgramDay.
     * @param {WorkoutProgramDayUpsertArgs} args - Arguments to update or create a WorkoutProgramDay.
     * @example
     * // Update or create a WorkoutProgramDay
     * const workoutProgramDay = await prisma.workoutProgramDay.upsert({
     *   create: {
     *     // ... data to create a WorkoutProgramDay
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the WorkoutProgramDay we want to update
     *   }
     * })
     */
    upsert<T extends WorkoutProgramDayUpsertArgs>(args: SelectSubset<T, WorkoutProgramDayUpsertArgs<ExtArgs>>): Prisma__WorkoutProgramDayClient<$Result.GetResult<Prisma.$WorkoutProgramDayPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of WorkoutProgramDays.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutProgramDayCountArgs} args - Arguments to filter WorkoutProgramDays to count.
     * @example
     * // Count the number of WorkoutProgramDays
     * const count = await prisma.workoutProgramDay.count({
     *   where: {
     *     // ... the filter for the WorkoutProgramDays we want to count
     *   }
     * })
    **/
    count<T extends WorkoutProgramDayCountArgs>(
      args?: Subset<T, WorkoutProgramDayCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], WorkoutProgramDayCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a WorkoutProgramDay.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutProgramDayAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends WorkoutProgramDayAggregateArgs>(args: Subset<T, WorkoutProgramDayAggregateArgs>): Prisma.PrismaPromise<GetWorkoutProgramDayAggregateType<T>>

    /**
     * Group by WorkoutProgramDay.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutProgramDayGroupByArgs} args - Group by arguments.
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
      T extends WorkoutProgramDayGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: WorkoutProgramDayGroupByArgs['orderBy'] }
        : { orderBy?: WorkoutProgramDayGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, WorkoutProgramDayGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetWorkoutProgramDayGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the WorkoutProgramDay model
   */
  readonly fields: WorkoutProgramDayFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for WorkoutProgramDay.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__WorkoutProgramDayClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    program<T extends WorkoutProgramDefaultArgs<ExtArgs> = {}>(args?: Subset<T, WorkoutProgramDefaultArgs<ExtArgs>>): Prisma__WorkoutProgramClient<$Result.GetResult<Prisma.$WorkoutProgramPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
    exercises<T extends WorkoutProgramDay$exercisesArgs<ExtArgs> = {}>(args?: Subset<T, WorkoutProgramDay$exercisesArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$WorkoutProgramExercisePayload<ExtArgs>, T, "findMany"> | Null>
    schedules<T extends WorkoutProgramDay$schedulesArgs<ExtArgs> = {}>(args?: Subset<T, WorkoutProgramDay$schedulesArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$WorkoutSchedulePayload<ExtArgs>, T, "findMany"> | Null>
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
   * Fields of the WorkoutProgramDay model
   */ 
  interface WorkoutProgramDayFieldRefs {
    readonly id: FieldRef<"WorkoutProgramDay", 'String'>
    readonly programId: FieldRef<"WorkoutProgramDay", 'String'>
    readonly dayNumber: FieldRef<"WorkoutProgramDay", 'Int'>
    readonly title: FieldRef<"WorkoutProgramDay", 'String'>
    readonly description: FieldRef<"WorkoutProgramDay", 'String'>
    readonly duration: FieldRef<"WorkoutProgramDay", 'Int'>
    readonly createdAt: FieldRef<"WorkoutProgramDay", 'DateTime'>
    readonly updatedAt: FieldRef<"WorkoutProgramDay", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * WorkoutProgramDay findUnique
   */
  export type WorkoutProgramDayFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutProgramDay
     */
    select?: WorkoutProgramDaySelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutProgramDayInclude<ExtArgs> | null
    /**
     * Filter, which WorkoutProgramDay to fetch.
     */
    where: WorkoutProgramDayWhereUniqueInput
  }

  /**
   * WorkoutProgramDay findUniqueOrThrow
   */
  export type WorkoutProgramDayFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutProgramDay
     */
    select?: WorkoutProgramDaySelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutProgramDayInclude<ExtArgs> | null
    /**
     * Filter, which WorkoutProgramDay to fetch.
     */
    where: WorkoutProgramDayWhereUniqueInput
  }

  /**
   * WorkoutProgramDay findFirst
   */
  export type WorkoutProgramDayFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutProgramDay
     */
    select?: WorkoutProgramDaySelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutProgramDayInclude<ExtArgs> | null
    /**
     * Filter, which WorkoutProgramDay to fetch.
     */
    where?: WorkoutProgramDayWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of WorkoutProgramDays to fetch.
     */
    orderBy?: WorkoutProgramDayOrderByWithRelationInput | WorkoutProgramDayOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for WorkoutProgramDays.
     */
    cursor?: WorkoutProgramDayWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` WorkoutProgramDays from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` WorkoutProgramDays.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of WorkoutProgramDays.
     */
    distinct?: WorkoutProgramDayScalarFieldEnum | WorkoutProgramDayScalarFieldEnum[]
  }

  /**
   * WorkoutProgramDay findFirstOrThrow
   */
  export type WorkoutProgramDayFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutProgramDay
     */
    select?: WorkoutProgramDaySelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutProgramDayInclude<ExtArgs> | null
    /**
     * Filter, which WorkoutProgramDay to fetch.
     */
    where?: WorkoutProgramDayWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of WorkoutProgramDays to fetch.
     */
    orderBy?: WorkoutProgramDayOrderByWithRelationInput | WorkoutProgramDayOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for WorkoutProgramDays.
     */
    cursor?: WorkoutProgramDayWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` WorkoutProgramDays from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` WorkoutProgramDays.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of WorkoutProgramDays.
     */
    distinct?: WorkoutProgramDayScalarFieldEnum | WorkoutProgramDayScalarFieldEnum[]
  }

  /**
   * WorkoutProgramDay findMany
   */
  export type WorkoutProgramDayFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutProgramDay
     */
    select?: WorkoutProgramDaySelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutProgramDayInclude<ExtArgs> | null
    /**
     * Filter, which WorkoutProgramDays to fetch.
     */
    where?: WorkoutProgramDayWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of WorkoutProgramDays to fetch.
     */
    orderBy?: WorkoutProgramDayOrderByWithRelationInput | WorkoutProgramDayOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing WorkoutProgramDays.
     */
    cursor?: WorkoutProgramDayWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` WorkoutProgramDays from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` WorkoutProgramDays.
     */
    skip?: number
    distinct?: WorkoutProgramDayScalarFieldEnum | WorkoutProgramDayScalarFieldEnum[]
  }

  /**
   * WorkoutProgramDay create
   */
  export type WorkoutProgramDayCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutProgramDay
     */
    select?: WorkoutProgramDaySelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutProgramDayInclude<ExtArgs> | null
    /**
     * The data needed to create a WorkoutProgramDay.
     */
    data: XOR<WorkoutProgramDayCreateInput, WorkoutProgramDayUncheckedCreateInput>
  }

  /**
   * WorkoutProgramDay createMany
   */
  export type WorkoutProgramDayCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many WorkoutProgramDays.
     */
    data: WorkoutProgramDayCreateManyInput | WorkoutProgramDayCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * WorkoutProgramDay createManyAndReturn
   */
  export type WorkoutProgramDayCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutProgramDay
     */
    select?: WorkoutProgramDaySelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many WorkoutProgramDays.
     */
    data: WorkoutProgramDayCreateManyInput | WorkoutProgramDayCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutProgramDayIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * WorkoutProgramDay update
   */
  export type WorkoutProgramDayUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutProgramDay
     */
    select?: WorkoutProgramDaySelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutProgramDayInclude<ExtArgs> | null
    /**
     * The data needed to update a WorkoutProgramDay.
     */
    data: XOR<WorkoutProgramDayUpdateInput, WorkoutProgramDayUncheckedUpdateInput>
    /**
     * Choose, which WorkoutProgramDay to update.
     */
    where: WorkoutProgramDayWhereUniqueInput
  }

  /**
   * WorkoutProgramDay updateMany
   */
  export type WorkoutProgramDayUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update WorkoutProgramDays.
     */
    data: XOR<WorkoutProgramDayUpdateManyMutationInput, WorkoutProgramDayUncheckedUpdateManyInput>
    /**
     * Filter which WorkoutProgramDays to update
     */
    where?: WorkoutProgramDayWhereInput
  }

  /**
   * WorkoutProgramDay upsert
   */
  export type WorkoutProgramDayUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutProgramDay
     */
    select?: WorkoutProgramDaySelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutProgramDayInclude<ExtArgs> | null
    /**
     * The filter to search for the WorkoutProgramDay to update in case it exists.
     */
    where: WorkoutProgramDayWhereUniqueInput
    /**
     * In case the WorkoutProgramDay found by the `where` argument doesn't exist, create a new WorkoutProgramDay with this data.
     */
    create: XOR<WorkoutProgramDayCreateInput, WorkoutProgramDayUncheckedCreateInput>
    /**
     * In case the WorkoutProgramDay was found with the provided `where` argument, update it with this data.
     */
    update: XOR<WorkoutProgramDayUpdateInput, WorkoutProgramDayUncheckedUpdateInput>
  }

  /**
   * WorkoutProgramDay delete
   */
  export type WorkoutProgramDayDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutProgramDay
     */
    select?: WorkoutProgramDaySelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutProgramDayInclude<ExtArgs> | null
    /**
     * Filter which WorkoutProgramDay to delete.
     */
    where: WorkoutProgramDayWhereUniqueInput
  }

  /**
   * WorkoutProgramDay deleteMany
   */
  export type WorkoutProgramDayDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which WorkoutProgramDays to delete
     */
    where?: WorkoutProgramDayWhereInput
  }

  /**
   * WorkoutProgramDay.exercises
   */
  export type WorkoutProgramDay$exercisesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutProgramExercise
     */
    select?: WorkoutProgramExerciseSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutProgramExerciseInclude<ExtArgs> | null
    where?: WorkoutProgramExerciseWhereInput
    orderBy?: WorkoutProgramExerciseOrderByWithRelationInput | WorkoutProgramExerciseOrderByWithRelationInput[]
    cursor?: WorkoutProgramExerciseWhereUniqueInput
    take?: number
    skip?: number
    distinct?: WorkoutProgramExerciseScalarFieldEnum | WorkoutProgramExerciseScalarFieldEnum[]
  }

  /**
   * WorkoutProgramDay.schedules
   */
  export type WorkoutProgramDay$schedulesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutSchedule
     */
    select?: WorkoutScheduleSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutScheduleInclude<ExtArgs> | null
    where?: WorkoutScheduleWhereInput
    orderBy?: WorkoutScheduleOrderByWithRelationInput | WorkoutScheduleOrderByWithRelationInput[]
    cursor?: WorkoutScheduleWhereUniqueInput
    take?: number
    skip?: number
    distinct?: WorkoutScheduleScalarFieldEnum | WorkoutScheduleScalarFieldEnum[]
  }

  /**
   * WorkoutProgramDay without action
   */
  export type WorkoutProgramDayDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutProgramDay
     */
    select?: WorkoutProgramDaySelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutProgramDayInclude<ExtArgs> | null
  }


  /**
   * Model WorkoutProgramExercise
   */

  export type AggregateWorkoutProgramExercise = {
    _count: WorkoutProgramExerciseCountAggregateOutputType | null
    _avg: WorkoutProgramExerciseAvgAggregateOutputType | null
    _sum: WorkoutProgramExerciseSumAggregateOutputType | null
    _min: WorkoutProgramExerciseMinAggregateOutputType | null
    _max: WorkoutProgramExerciseMaxAggregateOutputType | null
  }

  export type WorkoutProgramExerciseAvgAggregateOutputType = {
    order: number | null
    sets: number | null
    reps: number | null
    weight: number | null
    duration: number | null
    restSeconds: number | null
  }

  export type WorkoutProgramExerciseSumAggregateOutputType = {
    order: number | null
    sets: number | null
    reps: number | null
    weight: number | null
    duration: number | null
    restSeconds: number | null
  }

  export type WorkoutProgramExerciseMinAggregateOutputType = {
    id: string | null
    programDayId: string | null
    exerciseId: string | null
    order: number | null
    sets: number | null
    reps: number | null
    weight: number | null
    duration: number | null
    restSeconds: number | null
    notes: string | null
    createdAt: Date | null
  }

  export type WorkoutProgramExerciseMaxAggregateOutputType = {
    id: string | null
    programDayId: string | null
    exerciseId: string | null
    order: number | null
    sets: number | null
    reps: number | null
    weight: number | null
    duration: number | null
    restSeconds: number | null
    notes: string | null
    createdAt: Date | null
  }

  export type WorkoutProgramExerciseCountAggregateOutputType = {
    id: number
    programDayId: number
    exerciseId: number
    order: number
    sets: number
    reps: number
    weight: number
    duration: number
    restSeconds: number
    notes: number
    createdAt: number
    _all: number
  }


  export type WorkoutProgramExerciseAvgAggregateInputType = {
    order?: true
    sets?: true
    reps?: true
    weight?: true
    duration?: true
    restSeconds?: true
  }

  export type WorkoutProgramExerciseSumAggregateInputType = {
    order?: true
    sets?: true
    reps?: true
    weight?: true
    duration?: true
    restSeconds?: true
  }

  export type WorkoutProgramExerciseMinAggregateInputType = {
    id?: true
    programDayId?: true
    exerciseId?: true
    order?: true
    sets?: true
    reps?: true
    weight?: true
    duration?: true
    restSeconds?: true
    notes?: true
    createdAt?: true
  }

  export type WorkoutProgramExerciseMaxAggregateInputType = {
    id?: true
    programDayId?: true
    exerciseId?: true
    order?: true
    sets?: true
    reps?: true
    weight?: true
    duration?: true
    restSeconds?: true
    notes?: true
    createdAt?: true
  }

  export type WorkoutProgramExerciseCountAggregateInputType = {
    id?: true
    programDayId?: true
    exerciseId?: true
    order?: true
    sets?: true
    reps?: true
    weight?: true
    duration?: true
    restSeconds?: true
    notes?: true
    createdAt?: true
    _all?: true
  }

  export type WorkoutProgramExerciseAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which WorkoutProgramExercise to aggregate.
     */
    where?: WorkoutProgramExerciseWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of WorkoutProgramExercises to fetch.
     */
    orderBy?: WorkoutProgramExerciseOrderByWithRelationInput | WorkoutProgramExerciseOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: WorkoutProgramExerciseWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` WorkoutProgramExercises from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` WorkoutProgramExercises.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned WorkoutProgramExercises
    **/
    _count?: true | WorkoutProgramExerciseCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: WorkoutProgramExerciseAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: WorkoutProgramExerciseSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: WorkoutProgramExerciseMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: WorkoutProgramExerciseMaxAggregateInputType
  }

  export type GetWorkoutProgramExerciseAggregateType<T extends WorkoutProgramExerciseAggregateArgs> = {
        [P in keyof T & keyof AggregateWorkoutProgramExercise]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateWorkoutProgramExercise[P]>
      : GetScalarType<T[P], AggregateWorkoutProgramExercise[P]>
  }




  export type WorkoutProgramExerciseGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: WorkoutProgramExerciseWhereInput
    orderBy?: WorkoutProgramExerciseOrderByWithAggregationInput | WorkoutProgramExerciseOrderByWithAggregationInput[]
    by: WorkoutProgramExerciseScalarFieldEnum[] | WorkoutProgramExerciseScalarFieldEnum
    having?: WorkoutProgramExerciseScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: WorkoutProgramExerciseCountAggregateInputType | true
    _avg?: WorkoutProgramExerciseAvgAggregateInputType
    _sum?: WorkoutProgramExerciseSumAggregateInputType
    _min?: WorkoutProgramExerciseMinAggregateInputType
    _max?: WorkoutProgramExerciseMaxAggregateInputType
  }

  export type WorkoutProgramExerciseGroupByOutputType = {
    id: string
    programDayId: string
    exerciseId: string
    order: number
    sets: number | null
    reps: number | null
    weight: number | null
    duration: number | null
    restSeconds: number | null
    notes: string | null
    createdAt: Date
    _count: WorkoutProgramExerciseCountAggregateOutputType | null
    _avg: WorkoutProgramExerciseAvgAggregateOutputType | null
    _sum: WorkoutProgramExerciseSumAggregateOutputType | null
    _min: WorkoutProgramExerciseMinAggregateOutputType | null
    _max: WorkoutProgramExerciseMaxAggregateOutputType | null
  }

  type GetWorkoutProgramExerciseGroupByPayload<T extends WorkoutProgramExerciseGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<WorkoutProgramExerciseGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof WorkoutProgramExerciseGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], WorkoutProgramExerciseGroupByOutputType[P]>
            : GetScalarType<T[P], WorkoutProgramExerciseGroupByOutputType[P]>
        }
      >
    >


  export type WorkoutProgramExerciseSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    programDayId?: boolean
    exerciseId?: boolean
    order?: boolean
    sets?: boolean
    reps?: boolean
    weight?: boolean
    duration?: boolean
    restSeconds?: boolean
    notes?: boolean
    createdAt?: boolean
    programDay?: boolean | WorkoutProgramDayDefaultArgs<ExtArgs>
    exercise?: boolean | ExerciseDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["workoutProgramExercise"]>

  export type WorkoutProgramExerciseSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    programDayId?: boolean
    exerciseId?: boolean
    order?: boolean
    sets?: boolean
    reps?: boolean
    weight?: boolean
    duration?: boolean
    restSeconds?: boolean
    notes?: boolean
    createdAt?: boolean
    programDay?: boolean | WorkoutProgramDayDefaultArgs<ExtArgs>
    exercise?: boolean | ExerciseDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["workoutProgramExercise"]>

  export type WorkoutProgramExerciseSelectScalar = {
    id?: boolean
    programDayId?: boolean
    exerciseId?: boolean
    order?: boolean
    sets?: boolean
    reps?: boolean
    weight?: boolean
    duration?: boolean
    restSeconds?: boolean
    notes?: boolean
    createdAt?: boolean
  }

  export type WorkoutProgramExerciseInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    programDay?: boolean | WorkoutProgramDayDefaultArgs<ExtArgs>
    exercise?: boolean | ExerciseDefaultArgs<ExtArgs>
  }
  export type WorkoutProgramExerciseIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    programDay?: boolean | WorkoutProgramDayDefaultArgs<ExtArgs>
    exercise?: boolean | ExerciseDefaultArgs<ExtArgs>
  }

  export type $WorkoutProgramExercisePayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "WorkoutProgramExercise"
    objects: {
      programDay: Prisma.$WorkoutProgramDayPayload<ExtArgs>
      exercise: Prisma.$ExercisePayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      programDayId: string
      exerciseId: string
      order: number
      sets: number | null
      reps: number | null
      weight: number | null
      duration: number | null
      restSeconds: number | null
      notes: string | null
      createdAt: Date
    }, ExtArgs["result"]["workoutProgramExercise"]>
    composites: {}
  }

  type WorkoutProgramExerciseGetPayload<S extends boolean | null | undefined | WorkoutProgramExerciseDefaultArgs> = $Result.GetResult<Prisma.$WorkoutProgramExercisePayload, S>

  type WorkoutProgramExerciseCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<WorkoutProgramExerciseFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: WorkoutProgramExerciseCountAggregateInputType | true
    }

  export interface WorkoutProgramExerciseDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['WorkoutProgramExercise'], meta: { name: 'WorkoutProgramExercise' } }
    /**
     * Find zero or one WorkoutProgramExercise that matches the filter.
     * @param {WorkoutProgramExerciseFindUniqueArgs} args - Arguments to find a WorkoutProgramExercise
     * @example
     * // Get one WorkoutProgramExercise
     * const workoutProgramExercise = await prisma.workoutProgramExercise.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends WorkoutProgramExerciseFindUniqueArgs>(args: SelectSubset<T, WorkoutProgramExerciseFindUniqueArgs<ExtArgs>>): Prisma__WorkoutProgramExerciseClient<$Result.GetResult<Prisma.$WorkoutProgramExercisePayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one WorkoutProgramExercise that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {WorkoutProgramExerciseFindUniqueOrThrowArgs} args - Arguments to find a WorkoutProgramExercise
     * @example
     * // Get one WorkoutProgramExercise
     * const workoutProgramExercise = await prisma.workoutProgramExercise.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends WorkoutProgramExerciseFindUniqueOrThrowArgs>(args: SelectSubset<T, WorkoutProgramExerciseFindUniqueOrThrowArgs<ExtArgs>>): Prisma__WorkoutProgramExerciseClient<$Result.GetResult<Prisma.$WorkoutProgramExercisePayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first WorkoutProgramExercise that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutProgramExerciseFindFirstArgs} args - Arguments to find a WorkoutProgramExercise
     * @example
     * // Get one WorkoutProgramExercise
     * const workoutProgramExercise = await prisma.workoutProgramExercise.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends WorkoutProgramExerciseFindFirstArgs>(args?: SelectSubset<T, WorkoutProgramExerciseFindFirstArgs<ExtArgs>>): Prisma__WorkoutProgramExerciseClient<$Result.GetResult<Prisma.$WorkoutProgramExercisePayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first WorkoutProgramExercise that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutProgramExerciseFindFirstOrThrowArgs} args - Arguments to find a WorkoutProgramExercise
     * @example
     * // Get one WorkoutProgramExercise
     * const workoutProgramExercise = await prisma.workoutProgramExercise.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends WorkoutProgramExerciseFindFirstOrThrowArgs>(args?: SelectSubset<T, WorkoutProgramExerciseFindFirstOrThrowArgs<ExtArgs>>): Prisma__WorkoutProgramExerciseClient<$Result.GetResult<Prisma.$WorkoutProgramExercisePayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more WorkoutProgramExercises that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutProgramExerciseFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all WorkoutProgramExercises
     * const workoutProgramExercises = await prisma.workoutProgramExercise.findMany()
     * 
     * // Get first 10 WorkoutProgramExercises
     * const workoutProgramExercises = await prisma.workoutProgramExercise.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const workoutProgramExerciseWithIdOnly = await prisma.workoutProgramExercise.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends WorkoutProgramExerciseFindManyArgs>(args?: SelectSubset<T, WorkoutProgramExerciseFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$WorkoutProgramExercisePayload<ExtArgs>, T, "findMany">>

    /**
     * Create a WorkoutProgramExercise.
     * @param {WorkoutProgramExerciseCreateArgs} args - Arguments to create a WorkoutProgramExercise.
     * @example
     * // Create one WorkoutProgramExercise
     * const WorkoutProgramExercise = await prisma.workoutProgramExercise.create({
     *   data: {
     *     // ... data to create a WorkoutProgramExercise
     *   }
     * })
     * 
     */
    create<T extends WorkoutProgramExerciseCreateArgs>(args: SelectSubset<T, WorkoutProgramExerciseCreateArgs<ExtArgs>>): Prisma__WorkoutProgramExerciseClient<$Result.GetResult<Prisma.$WorkoutProgramExercisePayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many WorkoutProgramExercises.
     * @param {WorkoutProgramExerciseCreateManyArgs} args - Arguments to create many WorkoutProgramExercises.
     * @example
     * // Create many WorkoutProgramExercises
     * const workoutProgramExercise = await prisma.workoutProgramExercise.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends WorkoutProgramExerciseCreateManyArgs>(args?: SelectSubset<T, WorkoutProgramExerciseCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many WorkoutProgramExercises and returns the data saved in the database.
     * @param {WorkoutProgramExerciseCreateManyAndReturnArgs} args - Arguments to create many WorkoutProgramExercises.
     * @example
     * // Create many WorkoutProgramExercises
     * const workoutProgramExercise = await prisma.workoutProgramExercise.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many WorkoutProgramExercises and only return the `id`
     * const workoutProgramExerciseWithIdOnly = await prisma.workoutProgramExercise.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends WorkoutProgramExerciseCreateManyAndReturnArgs>(args?: SelectSubset<T, WorkoutProgramExerciseCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$WorkoutProgramExercisePayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a WorkoutProgramExercise.
     * @param {WorkoutProgramExerciseDeleteArgs} args - Arguments to delete one WorkoutProgramExercise.
     * @example
     * // Delete one WorkoutProgramExercise
     * const WorkoutProgramExercise = await prisma.workoutProgramExercise.delete({
     *   where: {
     *     // ... filter to delete one WorkoutProgramExercise
     *   }
     * })
     * 
     */
    delete<T extends WorkoutProgramExerciseDeleteArgs>(args: SelectSubset<T, WorkoutProgramExerciseDeleteArgs<ExtArgs>>): Prisma__WorkoutProgramExerciseClient<$Result.GetResult<Prisma.$WorkoutProgramExercisePayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one WorkoutProgramExercise.
     * @param {WorkoutProgramExerciseUpdateArgs} args - Arguments to update one WorkoutProgramExercise.
     * @example
     * // Update one WorkoutProgramExercise
     * const workoutProgramExercise = await prisma.workoutProgramExercise.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends WorkoutProgramExerciseUpdateArgs>(args: SelectSubset<T, WorkoutProgramExerciseUpdateArgs<ExtArgs>>): Prisma__WorkoutProgramExerciseClient<$Result.GetResult<Prisma.$WorkoutProgramExercisePayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more WorkoutProgramExercises.
     * @param {WorkoutProgramExerciseDeleteManyArgs} args - Arguments to filter WorkoutProgramExercises to delete.
     * @example
     * // Delete a few WorkoutProgramExercises
     * const { count } = await prisma.workoutProgramExercise.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends WorkoutProgramExerciseDeleteManyArgs>(args?: SelectSubset<T, WorkoutProgramExerciseDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more WorkoutProgramExercises.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutProgramExerciseUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many WorkoutProgramExercises
     * const workoutProgramExercise = await prisma.workoutProgramExercise.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends WorkoutProgramExerciseUpdateManyArgs>(args: SelectSubset<T, WorkoutProgramExerciseUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one WorkoutProgramExercise.
     * @param {WorkoutProgramExerciseUpsertArgs} args - Arguments to update or create a WorkoutProgramExercise.
     * @example
     * // Update or create a WorkoutProgramExercise
     * const workoutProgramExercise = await prisma.workoutProgramExercise.upsert({
     *   create: {
     *     // ... data to create a WorkoutProgramExercise
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the WorkoutProgramExercise we want to update
     *   }
     * })
     */
    upsert<T extends WorkoutProgramExerciseUpsertArgs>(args: SelectSubset<T, WorkoutProgramExerciseUpsertArgs<ExtArgs>>): Prisma__WorkoutProgramExerciseClient<$Result.GetResult<Prisma.$WorkoutProgramExercisePayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of WorkoutProgramExercises.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutProgramExerciseCountArgs} args - Arguments to filter WorkoutProgramExercises to count.
     * @example
     * // Count the number of WorkoutProgramExercises
     * const count = await prisma.workoutProgramExercise.count({
     *   where: {
     *     // ... the filter for the WorkoutProgramExercises we want to count
     *   }
     * })
    **/
    count<T extends WorkoutProgramExerciseCountArgs>(
      args?: Subset<T, WorkoutProgramExerciseCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], WorkoutProgramExerciseCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a WorkoutProgramExercise.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutProgramExerciseAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends WorkoutProgramExerciseAggregateArgs>(args: Subset<T, WorkoutProgramExerciseAggregateArgs>): Prisma.PrismaPromise<GetWorkoutProgramExerciseAggregateType<T>>

    /**
     * Group by WorkoutProgramExercise.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutProgramExerciseGroupByArgs} args - Group by arguments.
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
      T extends WorkoutProgramExerciseGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: WorkoutProgramExerciseGroupByArgs['orderBy'] }
        : { orderBy?: WorkoutProgramExerciseGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, WorkoutProgramExerciseGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetWorkoutProgramExerciseGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the WorkoutProgramExercise model
   */
  readonly fields: WorkoutProgramExerciseFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for WorkoutProgramExercise.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__WorkoutProgramExerciseClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    programDay<T extends WorkoutProgramDayDefaultArgs<ExtArgs> = {}>(args?: Subset<T, WorkoutProgramDayDefaultArgs<ExtArgs>>): Prisma__WorkoutProgramDayClient<$Result.GetResult<Prisma.$WorkoutProgramDayPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
    exercise<T extends ExerciseDefaultArgs<ExtArgs> = {}>(args?: Subset<T, ExerciseDefaultArgs<ExtArgs>>): Prisma__ExerciseClient<$Result.GetResult<Prisma.$ExercisePayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
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
   * Fields of the WorkoutProgramExercise model
   */ 
  interface WorkoutProgramExerciseFieldRefs {
    readonly id: FieldRef<"WorkoutProgramExercise", 'String'>
    readonly programDayId: FieldRef<"WorkoutProgramExercise", 'String'>
    readonly exerciseId: FieldRef<"WorkoutProgramExercise", 'String'>
    readonly order: FieldRef<"WorkoutProgramExercise", 'Int'>
    readonly sets: FieldRef<"WorkoutProgramExercise", 'Int'>
    readonly reps: FieldRef<"WorkoutProgramExercise", 'Int'>
    readonly weight: FieldRef<"WorkoutProgramExercise", 'Float'>
    readonly duration: FieldRef<"WorkoutProgramExercise", 'Int'>
    readonly restSeconds: FieldRef<"WorkoutProgramExercise", 'Int'>
    readonly notes: FieldRef<"WorkoutProgramExercise", 'String'>
    readonly createdAt: FieldRef<"WorkoutProgramExercise", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * WorkoutProgramExercise findUnique
   */
  export type WorkoutProgramExerciseFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutProgramExercise
     */
    select?: WorkoutProgramExerciseSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutProgramExerciseInclude<ExtArgs> | null
    /**
     * Filter, which WorkoutProgramExercise to fetch.
     */
    where: WorkoutProgramExerciseWhereUniqueInput
  }

  /**
   * WorkoutProgramExercise findUniqueOrThrow
   */
  export type WorkoutProgramExerciseFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutProgramExercise
     */
    select?: WorkoutProgramExerciseSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutProgramExerciseInclude<ExtArgs> | null
    /**
     * Filter, which WorkoutProgramExercise to fetch.
     */
    where: WorkoutProgramExerciseWhereUniqueInput
  }

  /**
   * WorkoutProgramExercise findFirst
   */
  export type WorkoutProgramExerciseFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutProgramExercise
     */
    select?: WorkoutProgramExerciseSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutProgramExerciseInclude<ExtArgs> | null
    /**
     * Filter, which WorkoutProgramExercise to fetch.
     */
    where?: WorkoutProgramExerciseWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of WorkoutProgramExercises to fetch.
     */
    orderBy?: WorkoutProgramExerciseOrderByWithRelationInput | WorkoutProgramExerciseOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for WorkoutProgramExercises.
     */
    cursor?: WorkoutProgramExerciseWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` WorkoutProgramExercises from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` WorkoutProgramExercises.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of WorkoutProgramExercises.
     */
    distinct?: WorkoutProgramExerciseScalarFieldEnum | WorkoutProgramExerciseScalarFieldEnum[]
  }

  /**
   * WorkoutProgramExercise findFirstOrThrow
   */
  export type WorkoutProgramExerciseFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutProgramExercise
     */
    select?: WorkoutProgramExerciseSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutProgramExerciseInclude<ExtArgs> | null
    /**
     * Filter, which WorkoutProgramExercise to fetch.
     */
    where?: WorkoutProgramExerciseWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of WorkoutProgramExercises to fetch.
     */
    orderBy?: WorkoutProgramExerciseOrderByWithRelationInput | WorkoutProgramExerciseOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for WorkoutProgramExercises.
     */
    cursor?: WorkoutProgramExerciseWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` WorkoutProgramExercises from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` WorkoutProgramExercises.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of WorkoutProgramExercises.
     */
    distinct?: WorkoutProgramExerciseScalarFieldEnum | WorkoutProgramExerciseScalarFieldEnum[]
  }

  /**
   * WorkoutProgramExercise findMany
   */
  export type WorkoutProgramExerciseFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutProgramExercise
     */
    select?: WorkoutProgramExerciseSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutProgramExerciseInclude<ExtArgs> | null
    /**
     * Filter, which WorkoutProgramExercises to fetch.
     */
    where?: WorkoutProgramExerciseWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of WorkoutProgramExercises to fetch.
     */
    orderBy?: WorkoutProgramExerciseOrderByWithRelationInput | WorkoutProgramExerciseOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing WorkoutProgramExercises.
     */
    cursor?: WorkoutProgramExerciseWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` WorkoutProgramExercises from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` WorkoutProgramExercises.
     */
    skip?: number
    distinct?: WorkoutProgramExerciseScalarFieldEnum | WorkoutProgramExerciseScalarFieldEnum[]
  }

  /**
   * WorkoutProgramExercise create
   */
  export type WorkoutProgramExerciseCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutProgramExercise
     */
    select?: WorkoutProgramExerciseSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutProgramExerciseInclude<ExtArgs> | null
    /**
     * The data needed to create a WorkoutProgramExercise.
     */
    data: XOR<WorkoutProgramExerciseCreateInput, WorkoutProgramExerciseUncheckedCreateInput>
  }

  /**
   * WorkoutProgramExercise createMany
   */
  export type WorkoutProgramExerciseCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many WorkoutProgramExercises.
     */
    data: WorkoutProgramExerciseCreateManyInput | WorkoutProgramExerciseCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * WorkoutProgramExercise createManyAndReturn
   */
  export type WorkoutProgramExerciseCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutProgramExercise
     */
    select?: WorkoutProgramExerciseSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many WorkoutProgramExercises.
     */
    data: WorkoutProgramExerciseCreateManyInput | WorkoutProgramExerciseCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutProgramExerciseIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * WorkoutProgramExercise update
   */
  export type WorkoutProgramExerciseUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutProgramExercise
     */
    select?: WorkoutProgramExerciseSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutProgramExerciseInclude<ExtArgs> | null
    /**
     * The data needed to update a WorkoutProgramExercise.
     */
    data: XOR<WorkoutProgramExerciseUpdateInput, WorkoutProgramExerciseUncheckedUpdateInput>
    /**
     * Choose, which WorkoutProgramExercise to update.
     */
    where: WorkoutProgramExerciseWhereUniqueInput
  }

  /**
   * WorkoutProgramExercise updateMany
   */
  export type WorkoutProgramExerciseUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update WorkoutProgramExercises.
     */
    data: XOR<WorkoutProgramExerciseUpdateManyMutationInput, WorkoutProgramExerciseUncheckedUpdateManyInput>
    /**
     * Filter which WorkoutProgramExercises to update
     */
    where?: WorkoutProgramExerciseWhereInput
  }

  /**
   * WorkoutProgramExercise upsert
   */
  export type WorkoutProgramExerciseUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutProgramExercise
     */
    select?: WorkoutProgramExerciseSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutProgramExerciseInclude<ExtArgs> | null
    /**
     * The filter to search for the WorkoutProgramExercise to update in case it exists.
     */
    where: WorkoutProgramExerciseWhereUniqueInput
    /**
     * In case the WorkoutProgramExercise found by the `where` argument doesn't exist, create a new WorkoutProgramExercise with this data.
     */
    create: XOR<WorkoutProgramExerciseCreateInput, WorkoutProgramExerciseUncheckedCreateInput>
    /**
     * In case the WorkoutProgramExercise was found with the provided `where` argument, update it with this data.
     */
    update: XOR<WorkoutProgramExerciseUpdateInput, WorkoutProgramExerciseUncheckedUpdateInput>
  }

  /**
   * WorkoutProgramExercise delete
   */
  export type WorkoutProgramExerciseDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutProgramExercise
     */
    select?: WorkoutProgramExerciseSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutProgramExerciseInclude<ExtArgs> | null
    /**
     * Filter which WorkoutProgramExercise to delete.
     */
    where: WorkoutProgramExerciseWhereUniqueInput
  }

  /**
   * WorkoutProgramExercise deleteMany
   */
  export type WorkoutProgramExerciseDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which WorkoutProgramExercises to delete
     */
    where?: WorkoutProgramExerciseWhereInput
  }

  /**
   * WorkoutProgramExercise without action
   */
  export type WorkoutProgramExerciseDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutProgramExercise
     */
    select?: WorkoutProgramExerciseSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutProgramExerciseInclude<ExtArgs> | null
  }


  /**
   * Model WorkoutSchedule
   */

  export type AggregateWorkoutSchedule = {
    _count: WorkoutScheduleCountAggregateOutputType | null
    _min: WorkoutScheduleMinAggregateOutputType | null
    _max: WorkoutScheduleMaxAggregateOutputType | null
  }

  export type WorkoutScheduleMinAggregateOutputType = {
    id: string | null
    userId: string | null
    date: Date | null
    programDayId: string | null
    workoutId: string | null
    notes: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type WorkoutScheduleMaxAggregateOutputType = {
    id: string | null
    userId: string | null
    date: Date | null
    programDayId: string | null
    workoutId: string | null
    notes: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type WorkoutScheduleCountAggregateOutputType = {
    id: number
    userId: number
    date: number
    programDayId: number
    workoutId: number
    notes: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type WorkoutScheduleMinAggregateInputType = {
    id?: true
    userId?: true
    date?: true
    programDayId?: true
    workoutId?: true
    notes?: true
    createdAt?: true
    updatedAt?: true
  }

  export type WorkoutScheduleMaxAggregateInputType = {
    id?: true
    userId?: true
    date?: true
    programDayId?: true
    workoutId?: true
    notes?: true
    createdAt?: true
    updatedAt?: true
  }

  export type WorkoutScheduleCountAggregateInputType = {
    id?: true
    userId?: true
    date?: true
    programDayId?: true
    workoutId?: true
    notes?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type WorkoutScheduleAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which WorkoutSchedule to aggregate.
     */
    where?: WorkoutScheduleWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of WorkoutSchedules to fetch.
     */
    orderBy?: WorkoutScheduleOrderByWithRelationInput | WorkoutScheduleOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: WorkoutScheduleWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` WorkoutSchedules from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` WorkoutSchedules.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned WorkoutSchedules
    **/
    _count?: true | WorkoutScheduleCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: WorkoutScheduleMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: WorkoutScheduleMaxAggregateInputType
  }

  export type GetWorkoutScheduleAggregateType<T extends WorkoutScheduleAggregateArgs> = {
        [P in keyof T & keyof AggregateWorkoutSchedule]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateWorkoutSchedule[P]>
      : GetScalarType<T[P], AggregateWorkoutSchedule[P]>
  }




  export type WorkoutScheduleGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: WorkoutScheduleWhereInput
    orderBy?: WorkoutScheduleOrderByWithAggregationInput | WorkoutScheduleOrderByWithAggregationInput[]
    by: WorkoutScheduleScalarFieldEnum[] | WorkoutScheduleScalarFieldEnum
    having?: WorkoutScheduleScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: WorkoutScheduleCountAggregateInputType | true
    _min?: WorkoutScheduleMinAggregateInputType
    _max?: WorkoutScheduleMaxAggregateInputType
  }

  export type WorkoutScheduleGroupByOutputType = {
    id: string
    userId: string
    date: Date
    programDayId: string | null
    workoutId: string | null
    notes: string | null
    createdAt: Date
    updatedAt: Date
    _count: WorkoutScheduleCountAggregateOutputType | null
    _min: WorkoutScheduleMinAggregateOutputType | null
    _max: WorkoutScheduleMaxAggregateOutputType | null
  }

  type GetWorkoutScheduleGroupByPayload<T extends WorkoutScheduleGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<WorkoutScheduleGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof WorkoutScheduleGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], WorkoutScheduleGroupByOutputType[P]>
            : GetScalarType<T[P], WorkoutScheduleGroupByOutputType[P]>
        }
      >
    >


  export type WorkoutScheduleSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    userId?: boolean
    date?: boolean
    programDayId?: boolean
    workoutId?: boolean
    notes?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    programDay?: boolean | WorkoutSchedule$programDayArgs<ExtArgs>
    workout?: boolean | WorkoutSchedule$workoutArgs<ExtArgs>
  }, ExtArgs["result"]["workoutSchedule"]>

  export type WorkoutScheduleSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    userId?: boolean
    date?: boolean
    programDayId?: boolean
    workoutId?: boolean
    notes?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    programDay?: boolean | WorkoutSchedule$programDayArgs<ExtArgs>
    workout?: boolean | WorkoutSchedule$workoutArgs<ExtArgs>
  }, ExtArgs["result"]["workoutSchedule"]>

  export type WorkoutScheduleSelectScalar = {
    id?: boolean
    userId?: boolean
    date?: boolean
    programDayId?: boolean
    workoutId?: boolean
    notes?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type WorkoutScheduleInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    programDay?: boolean | WorkoutSchedule$programDayArgs<ExtArgs>
    workout?: boolean | WorkoutSchedule$workoutArgs<ExtArgs>
  }
  export type WorkoutScheduleIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    programDay?: boolean | WorkoutSchedule$programDayArgs<ExtArgs>
    workout?: boolean | WorkoutSchedule$workoutArgs<ExtArgs>
  }

  export type $WorkoutSchedulePayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "WorkoutSchedule"
    objects: {
      programDay: Prisma.$WorkoutProgramDayPayload<ExtArgs> | null
      workout: Prisma.$WorkoutPayload<ExtArgs> | null
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      userId: string
      date: Date
      programDayId: string | null
      workoutId: string | null
      notes: string | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["workoutSchedule"]>
    composites: {}
  }

  type WorkoutScheduleGetPayload<S extends boolean | null | undefined | WorkoutScheduleDefaultArgs> = $Result.GetResult<Prisma.$WorkoutSchedulePayload, S>

  type WorkoutScheduleCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<WorkoutScheduleFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: WorkoutScheduleCountAggregateInputType | true
    }

  export interface WorkoutScheduleDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['WorkoutSchedule'], meta: { name: 'WorkoutSchedule' } }
    /**
     * Find zero or one WorkoutSchedule that matches the filter.
     * @param {WorkoutScheduleFindUniqueArgs} args - Arguments to find a WorkoutSchedule
     * @example
     * // Get one WorkoutSchedule
     * const workoutSchedule = await prisma.workoutSchedule.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends WorkoutScheduleFindUniqueArgs>(args: SelectSubset<T, WorkoutScheduleFindUniqueArgs<ExtArgs>>): Prisma__WorkoutScheduleClient<$Result.GetResult<Prisma.$WorkoutSchedulePayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one WorkoutSchedule that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {WorkoutScheduleFindUniqueOrThrowArgs} args - Arguments to find a WorkoutSchedule
     * @example
     * // Get one WorkoutSchedule
     * const workoutSchedule = await prisma.workoutSchedule.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends WorkoutScheduleFindUniqueOrThrowArgs>(args: SelectSubset<T, WorkoutScheduleFindUniqueOrThrowArgs<ExtArgs>>): Prisma__WorkoutScheduleClient<$Result.GetResult<Prisma.$WorkoutSchedulePayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first WorkoutSchedule that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutScheduleFindFirstArgs} args - Arguments to find a WorkoutSchedule
     * @example
     * // Get one WorkoutSchedule
     * const workoutSchedule = await prisma.workoutSchedule.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends WorkoutScheduleFindFirstArgs>(args?: SelectSubset<T, WorkoutScheduleFindFirstArgs<ExtArgs>>): Prisma__WorkoutScheduleClient<$Result.GetResult<Prisma.$WorkoutSchedulePayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first WorkoutSchedule that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutScheduleFindFirstOrThrowArgs} args - Arguments to find a WorkoutSchedule
     * @example
     * // Get one WorkoutSchedule
     * const workoutSchedule = await prisma.workoutSchedule.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends WorkoutScheduleFindFirstOrThrowArgs>(args?: SelectSubset<T, WorkoutScheduleFindFirstOrThrowArgs<ExtArgs>>): Prisma__WorkoutScheduleClient<$Result.GetResult<Prisma.$WorkoutSchedulePayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more WorkoutSchedules that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutScheduleFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all WorkoutSchedules
     * const workoutSchedules = await prisma.workoutSchedule.findMany()
     * 
     * // Get first 10 WorkoutSchedules
     * const workoutSchedules = await prisma.workoutSchedule.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const workoutScheduleWithIdOnly = await prisma.workoutSchedule.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends WorkoutScheduleFindManyArgs>(args?: SelectSubset<T, WorkoutScheduleFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$WorkoutSchedulePayload<ExtArgs>, T, "findMany">>

    /**
     * Create a WorkoutSchedule.
     * @param {WorkoutScheduleCreateArgs} args - Arguments to create a WorkoutSchedule.
     * @example
     * // Create one WorkoutSchedule
     * const WorkoutSchedule = await prisma.workoutSchedule.create({
     *   data: {
     *     // ... data to create a WorkoutSchedule
     *   }
     * })
     * 
     */
    create<T extends WorkoutScheduleCreateArgs>(args: SelectSubset<T, WorkoutScheduleCreateArgs<ExtArgs>>): Prisma__WorkoutScheduleClient<$Result.GetResult<Prisma.$WorkoutSchedulePayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many WorkoutSchedules.
     * @param {WorkoutScheduleCreateManyArgs} args - Arguments to create many WorkoutSchedules.
     * @example
     * // Create many WorkoutSchedules
     * const workoutSchedule = await prisma.workoutSchedule.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends WorkoutScheduleCreateManyArgs>(args?: SelectSubset<T, WorkoutScheduleCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many WorkoutSchedules and returns the data saved in the database.
     * @param {WorkoutScheduleCreateManyAndReturnArgs} args - Arguments to create many WorkoutSchedules.
     * @example
     * // Create many WorkoutSchedules
     * const workoutSchedule = await prisma.workoutSchedule.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many WorkoutSchedules and only return the `id`
     * const workoutScheduleWithIdOnly = await prisma.workoutSchedule.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends WorkoutScheduleCreateManyAndReturnArgs>(args?: SelectSubset<T, WorkoutScheduleCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$WorkoutSchedulePayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a WorkoutSchedule.
     * @param {WorkoutScheduleDeleteArgs} args - Arguments to delete one WorkoutSchedule.
     * @example
     * // Delete one WorkoutSchedule
     * const WorkoutSchedule = await prisma.workoutSchedule.delete({
     *   where: {
     *     // ... filter to delete one WorkoutSchedule
     *   }
     * })
     * 
     */
    delete<T extends WorkoutScheduleDeleteArgs>(args: SelectSubset<T, WorkoutScheduleDeleteArgs<ExtArgs>>): Prisma__WorkoutScheduleClient<$Result.GetResult<Prisma.$WorkoutSchedulePayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one WorkoutSchedule.
     * @param {WorkoutScheduleUpdateArgs} args - Arguments to update one WorkoutSchedule.
     * @example
     * // Update one WorkoutSchedule
     * const workoutSchedule = await prisma.workoutSchedule.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends WorkoutScheduleUpdateArgs>(args: SelectSubset<T, WorkoutScheduleUpdateArgs<ExtArgs>>): Prisma__WorkoutScheduleClient<$Result.GetResult<Prisma.$WorkoutSchedulePayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more WorkoutSchedules.
     * @param {WorkoutScheduleDeleteManyArgs} args - Arguments to filter WorkoutSchedules to delete.
     * @example
     * // Delete a few WorkoutSchedules
     * const { count } = await prisma.workoutSchedule.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends WorkoutScheduleDeleteManyArgs>(args?: SelectSubset<T, WorkoutScheduleDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more WorkoutSchedules.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutScheduleUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many WorkoutSchedules
     * const workoutSchedule = await prisma.workoutSchedule.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends WorkoutScheduleUpdateManyArgs>(args: SelectSubset<T, WorkoutScheduleUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one WorkoutSchedule.
     * @param {WorkoutScheduleUpsertArgs} args - Arguments to update or create a WorkoutSchedule.
     * @example
     * // Update or create a WorkoutSchedule
     * const workoutSchedule = await prisma.workoutSchedule.upsert({
     *   create: {
     *     // ... data to create a WorkoutSchedule
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the WorkoutSchedule we want to update
     *   }
     * })
     */
    upsert<T extends WorkoutScheduleUpsertArgs>(args: SelectSubset<T, WorkoutScheduleUpsertArgs<ExtArgs>>): Prisma__WorkoutScheduleClient<$Result.GetResult<Prisma.$WorkoutSchedulePayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of WorkoutSchedules.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutScheduleCountArgs} args - Arguments to filter WorkoutSchedules to count.
     * @example
     * // Count the number of WorkoutSchedules
     * const count = await prisma.workoutSchedule.count({
     *   where: {
     *     // ... the filter for the WorkoutSchedules we want to count
     *   }
     * })
    **/
    count<T extends WorkoutScheduleCountArgs>(
      args?: Subset<T, WorkoutScheduleCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], WorkoutScheduleCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a WorkoutSchedule.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutScheduleAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends WorkoutScheduleAggregateArgs>(args: Subset<T, WorkoutScheduleAggregateArgs>): Prisma.PrismaPromise<GetWorkoutScheduleAggregateType<T>>

    /**
     * Group by WorkoutSchedule.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WorkoutScheduleGroupByArgs} args - Group by arguments.
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
      T extends WorkoutScheduleGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: WorkoutScheduleGroupByArgs['orderBy'] }
        : { orderBy?: WorkoutScheduleGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, WorkoutScheduleGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetWorkoutScheduleGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the WorkoutSchedule model
   */
  readonly fields: WorkoutScheduleFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for WorkoutSchedule.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__WorkoutScheduleClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    programDay<T extends WorkoutSchedule$programDayArgs<ExtArgs> = {}>(args?: Subset<T, WorkoutSchedule$programDayArgs<ExtArgs>>): Prisma__WorkoutProgramDayClient<$Result.GetResult<Prisma.$WorkoutProgramDayPayload<ExtArgs>, T, "findUniqueOrThrow"> | null, null, ExtArgs>
    workout<T extends WorkoutSchedule$workoutArgs<ExtArgs> = {}>(args?: Subset<T, WorkoutSchedule$workoutArgs<ExtArgs>>): Prisma__WorkoutClient<$Result.GetResult<Prisma.$WorkoutPayload<ExtArgs>, T, "findUniqueOrThrow"> | null, null, ExtArgs>
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
   * Fields of the WorkoutSchedule model
   */ 
  interface WorkoutScheduleFieldRefs {
    readonly id: FieldRef<"WorkoutSchedule", 'String'>
    readonly userId: FieldRef<"WorkoutSchedule", 'String'>
    readonly date: FieldRef<"WorkoutSchedule", 'DateTime'>
    readonly programDayId: FieldRef<"WorkoutSchedule", 'String'>
    readonly workoutId: FieldRef<"WorkoutSchedule", 'String'>
    readonly notes: FieldRef<"WorkoutSchedule", 'String'>
    readonly createdAt: FieldRef<"WorkoutSchedule", 'DateTime'>
    readonly updatedAt: FieldRef<"WorkoutSchedule", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * WorkoutSchedule findUnique
   */
  export type WorkoutScheduleFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutSchedule
     */
    select?: WorkoutScheduleSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutScheduleInclude<ExtArgs> | null
    /**
     * Filter, which WorkoutSchedule to fetch.
     */
    where: WorkoutScheduleWhereUniqueInput
  }

  /**
   * WorkoutSchedule findUniqueOrThrow
   */
  export type WorkoutScheduleFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutSchedule
     */
    select?: WorkoutScheduleSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutScheduleInclude<ExtArgs> | null
    /**
     * Filter, which WorkoutSchedule to fetch.
     */
    where: WorkoutScheduleWhereUniqueInput
  }

  /**
   * WorkoutSchedule findFirst
   */
  export type WorkoutScheduleFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutSchedule
     */
    select?: WorkoutScheduleSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutScheduleInclude<ExtArgs> | null
    /**
     * Filter, which WorkoutSchedule to fetch.
     */
    where?: WorkoutScheduleWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of WorkoutSchedules to fetch.
     */
    orderBy?: WorkoutScheduleOrderByWithRelationInput | WorkoutScheduleOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for WorkoutSchedules.
     */
    cursor?: WorkoutScheduleWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` WorkoutSchedules from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` WorkoutSchedules.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of WorkoutSchedules.
     */
    distinct?: WorkoutScheduleScalarFieldEnum | WorkoutScheduleScalarFieldEnum[]
  }

  /**
   * WorkoutSchedule findFirstOrThrow
   */
  export type WorkoutScheduleFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutSchedule
     */
    select?: WorkoutScheduleSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutScheduleInclude<ExtArgs> | null
    /**
     * Filter, which WorkoutSchedule to fetch.
     */
    where?: WorkoutScheduleWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of WorkoutSchedules to fetch.
     */
    orderBy?: WorkoutScheduleOrderByWithRelationInput | WorkoutScheduleOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for WorkoutSchedules.
     */
    cursor?: WorkoutScheduleWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` WorkoutSchedules from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` WorkoutSchedules.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of WorkoutSchedules.
     */
    distinct?: WorkoutScheduleScalarFieldEnum | WorkoutScheduleScalarFieldEnum[]
  }

  /**
   * WorkoutSchedule findMany
   */
  export type WorkoutScheduleFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutSchedule
     */
    select?: WorkoutScheduleSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutScheduleInclude<ExtArgs> | null
    /**
     * Filter, which WorkoutSchedules to fetch.
     */
    where?: WorkoutScheduleWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of WorkoutSchedules to fetch.
     */
    orderBy?: WorkoutScheduleOrderByWithRelationInput | WorkoutScheduleOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing WorkoutSchedules.
     */
    cursor?: WorkoutScheduleWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` WorkoutSchedules from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` WorkoutSchedules.
     */
    skip?: number
    distinct?: WorkoutScheduleScalarFieldEnum | WorkoutScheduleScalarFieldEnum[]
  }

  /**
   * WorkoutSchedule create
   */
  export type WorkoutScheduleCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutSchedule
     */
    select?: WorkoutScheduleSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutScheduleInclude<ExtArgs> | null
    /**
     * The data needed to create a WorkoutSchedule.
     */
    data: XOR<WorkoutScheduleCreateInput, WorkoutScheduleUncheckedCreateInput>
  }

  /**
   * WorkoutSchedule createMany
   */
  export type WorkoutScheduleCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many WorkoutSchedules.
     */
    data: WorkoutScheduleCreateManyInput | WorkoutScheduleCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * WorkoutSchedule createManyAndReturn
   */
  export type WorkoutScheduleCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutSchedule
     */
    select?: WorkoutScheduleSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many WorkoutSchedules.
     */
    data: WorkoutScheduleCreateManyInput | WorkoutScheduleCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutScheduleIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * WorkoutSchedule update
   */
  export type WorkoutScheduleUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutSchedule
     */
    select?: WorkoutScheduleSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutScheduleInclude<ExtArgs> | null
    /**
     * The data needed to update a WorkoutSchedule.
     */
    data: XOR<WorkoutScheduleUpdateInput, WorkoutScheduleUncheckedUpdateInput>
    /**
     * Choose, which WorkoutSchedule to update.
     */
    where: WorkoutScheduleWhereUniqueInput
  }

  /**
   * WorkoutSchedule updateMany
   */
  export type WorkoutScheduleUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update WorkoutSchedules.
     */
    data: XOR<WorkoutScheduleUpdateManyMutationInput, WorkoutScheduleUncheckedUpdateManyInput>
    /**
     * Filter which WorkoutSchedules to update
     */
    where?: WorkoutScheduleWhereInput
  }

  /**
   * WorkoutSchedule upsert
   */
  export type WorkoutScheduleUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutSchedule
     */
    select?: WorkoutScheduleSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutScheduleInclude<ExtArgs> | null
    /**
     * The filter to search for the WorkoutSchedule to update in case it exists.
     */
    where: WorkoutScheduleWhereUniqueInput
    /**
     * In case the WorkoutSchedule found by the `where` argument doesn't exist, create a new WorkoutSchedule with this data.
     */
    create: XOR<WorkoutScheduleCreateInput, WorkoutScheduleUncheckedCreateInput>
    /**
     * In case the WorkoutSchedule was found with the provided `where` argument, update it with this data.
     */
    update: XOR<WorkoutScheduleUpdateInput, WorkoutScheduleUncheckedUpdateInput>
  }

  /**
   * WorkoutSchedule delete
   */
  export type WorkoutScheduleDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutSchedule
     */
    select?: WorkoutScheduleSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutScheduleInclude<ExtArgs> | null
    /**
     * Filter which WorkoutSchedule to delete.
     */
    where: WorkoutScheduleWhereUniqueInput
  }

  /**
   * WorkoutSchedule deleteMany
   */
  export type WorkoutScheduleDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which WorkoutSchedules to delete
     */
    where?: WorkoutScheduleWhereInput
  }

  /**
   * WorkoutSchedule.programDay
   */
  export type WorkoutSchedule$programDayArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutProgramDay
     */
    select?: WorkoutProgramDaySelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutProgramDayInclude<ExtArgs> | null
    where?: WorkoutProgramDayWhereInput
  }

  /**
   * WorkoutSchedule.workout
   */
  export type WorkoutSchedule$workoutArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Workout
     */
    select?: WorkoutSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutInclude<ExtArgs> | null
    where?: WorkoutWhereInput
  }

  /**
   * WorkoutSchedule without action
   */
  export type WorkoutScheduleDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WorkoutSchedule
     */
    select?: WorkoutScheduleSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: WorkoutScheduleInclude<ExtArgs> | null
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


  export const ExerciseScalarFieldEnum: {
    id: 'id',
    exerciseName: 'exerciseName',
    typeOfActivity: 'typeOfActivity',
    typeOfEquipment: 'typeOfEquipment',
    bodyPart: 'bodyPart',
    type: 'type',
    muscleGroupsActivated: 'muscleGroupsActivated',
    instructions: 'instructions',
    videoUrl: 'videoUrl',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type ExerciseScalarFieldEnum = (typeof ExerciseScalarFieldEnum)[keyof typeof ExerciseScalarFieldEnum]


  export const WorkoutScalarFieldEnum: {
    id: 'id',
    userId: 'userId',
    name: 'name',
    description: 'description',
    date: 'date',
    duration: 'duration',
    notes: 'notes',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type WorkoutScalarFieldEnum = (typeof WorkoutScalarFieldEnum)[keyof typeof WorkoutScalarFieldEnum]


  export const WorkoutExerciseScalarFieldEnum: {
    id: 'id',
    workoutId: 'workoutId',
    exerciseId: 'exerciseId',
    sets: 'sets',
    reps: 'reps',
    duration: 'duration',
    weight: 'weight',
    notes: 'notes',
    order: 'order',
    createdAt: 'createdAt'
  };

  export type WorkoutExerciseScalarFieldEnum = (typeof WorkoutExerciseScalarFieldEnum)[keyof typeof WorkoutExerciseScalarFieldEnum]


  export const WorkoutSetScalarFieldEnum: {
    id: 'id',
    workoutExerciseId: 'workoutExerciseId',
    setNumber: 'setNumber',
    reps: 'reps',
    weight: 'weight',
    rpe: 'rpe',
    completed: 'completed',
    createdAt: 'createdAt'
  };

  export type WorkoutSetScalarFieldEnum = (typeof WorkoutSetScalarFieldEnum)[keyof typeof WorkoutSetScalarFieldEnum]


  export const FoodScalarFieldEnum: {
    id: 'id',
    fdcId: 'fdcId',
    name: 'name',
    calories: 'calories',
    protein: 'protein',
    carbs: 'carbs',
    fats: 'fats',
    source: 'source',
    imageUrl: 'imageUrl'
  };

  export type FoodScalarFieldEnum = (typeof FoodScalarFieldEnum)[keyof typeof FoodScalarFieldEnum]


  export const NutritionLogScalarFieldEnum: {
    id: 'id',
    userId: 'userId',
    date: 'date',
    mealType: 'mealType',
    foodName: 'foodName',
    calories: 'calories',
    protein: 'protein',
    carbs: 'carbs',
    fats: 'fats',
    notes: 'notes',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type NutritionLogScalarFieldEnum = (typeof NutritionLogScalarFieldEnum)[keyof typeof NutritionLogScalarFieldEnum]


  export const NutritionGoalScalarFieldEnum: {
    id: 'id',
    userId: 'userId',
    calories: 'calories',
    protein: 'protein',
    carbs: 'carbs',
    fat: 'fat',
    waterMl: 'waterMl',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type NutritionGoalScalarFieldEnum = (typeof NutritionGoalScalarFieldEnum)[keyof typeof NutritionGoalScalarFieldEnum]


  export const BodyMetricsScalarFieldEnum: {
    id: 'id',
    userId: 'userId',
    date: 'date',
    weight: 'weight',
    bodyFat: 'bodyFat',
    muscleMass: 'muscleMass',
    bodyWater: 'bodyWater',
    notes: 'notes',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type BodyMetricsScalarFieldEnum = (typeof BodyMetricsScalarFieldEnum)[keyof typeof BodyMetricsScalarFieldEnum]


  export const WorkoutProgramScalarFieldEnum: {
    id: 'id',
    userId: 'userId',
    name: 'name',
    description: 'description',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type WorkoutProgramScalarFieldEnum = (typeof WorkoutProgramScalarFieldEnum)[keyof typeof WorkoutProgramScalarFieldEnum]


  export const WorkoutProgramDayScalarFieldEnum: {
    id: 'id',
    programId: 'programId',
    dayNumber: 'dayNumber',
    title: 'title',
    description: 'description',
    duration: 'duration',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type WorkoutProgramDayScalarFieldEnum = (typeof WorkoutProgramDayScalarFieldEnum)[keyof typeof WorkoutProgramDayScalarFieldEnum]


  export const WorkoutProgramExerciseScalarFieldEnum: {
    id: 'id',
    programDayId: 'programDayId',
    exerciseId: 'exerciseId',
    order: 'order',
    sets: 'sets',
    reps: 'reps',
    weight: 'weight',
    duration: 'duration',
    restSeconds: 'restSeconds',
    notes: 'notes',
    createdAt: 'createdAt'
  };

  export type WorkoutProgramExerciseScalarFieldEnum = (typeof WorkoutProgramExerciseScalarFieldEnum)[keyof typeof WorkoutProgramExerciseScalarFieldEnum]


  export const WorkoutScheduleScalarFieldEnum: {
    id: 'id',
    userId: 'userId',
    date: 'date',
    programDayId: 'programDayId',
    workoutId: 'workoutId',
    notes: 'notes',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type WorkoutScheduleScalarFieldEnum = (typeof WorkoutScheduleScalarFieldEnum)[keyof typeof WorkoutScheduleScalarFieldEnum]


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
   * Reference to a field of type 'ExerciseType'
   */
  export type EnumExerciseTypeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'ExerciseType'>
    


  /**
   * Reference to a field of type 'ExerciseType[]'
   */
  export type ListEnumExerciseTypeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'ExerciseType[]'>
    


  /**
   * Reference to a field of type 'EquipmentType'
   */
  export type EnumEquipmentTypeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'EquipmentType'>
    


  /**
   * Reference to a field of type 'EquipmentType[]'
   */
  export type ListEnumEquipmentTypeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'EquipmentType[]'>
    


  /**
   * Reference to a field of type 'BodyPart'
   */
  export type EnumBodyPartFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'BodyPart'>
    


  /**
   * Reference to a field of type 'BodyPart[]'
   */
  export type ListEnumBodyPartFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'BodyPart[]'>
    


  /**
   * Reference to a field of type 'MovementType'
   */
  export type EnumMovementTypeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'MovementType'>
    


  /**
   * Reference to a field of type 'MovementType[]'
   */
  export type ListEnumMovementTypeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'MovementType[]'>
    


  /**
   * Reference to a field of type 'DateTime'
   */
  export type DateTimeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'DateTime'>
    


  /**
   * Reference to a field of type 'DateTime[]'
   */
  export type ListDateTimeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'DateTime[]'>
    


  /**
   * Reference to a field of type 'Int'
   */
  export type IntFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Int'>
    


  /**
   * Reference to a field of type 'Int[]'
   */
  export type ListIntFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Int[]'>
    


  /**
   * Reference to a field of type 'Float'
   */
  export type FloatFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Float'>
    


  /**
   * Reference to a field of type 'Float[]'
   */
  export type ListFloatFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Float[]'>
    


  /**
   * Reference to a field of type 'Boolean'
   */
  export type BooleanFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Boolean'>
    
  /**
   * Deep Input Types
   */


  export type ExerciseWhereInput = {
    AND?: ExerciseWhereInput | ExerciseWhereInput[]
    OR?: ExerciseWhereInput[]
    NOT?: ExerciseWhereInput | ExerciseWhereInput[]
    id?: StringFilter<"Exercise"> | string
    exerciseName?: StringFilter<"Exercise"> | string
    typeOfActivity?: EnumExerciseTypeFilter<"Exercise"> | $Enums.ExerciseType
    typeOfEquipment?: EnumEquipmentTypeFilter<"Exercise"> | $Enums.EquipmentType
    bodyPart?: EnumBodyPartFilter<"Exercise"> | $Enums.BodyPart
    type?: EnumMovementTypeFilter<"Exercise"> | $Enums.MovementType
    muscleGroupsActivated?: StringNullableListFilter<"Exercise">
    instructions?: StringFilter<"Exercise"> | string
    videoUrl?: StringNullableFilter<"Exercise"> | string | null
    createdAt?: DateTimeFilter<"Exercise"> | Date | string
    updatedAt?: DateTimeFilter<"Exercise"> | Date | string
    workoutExercises?: WorkoutExerciseListRelationFilter
    workoutProgramExercises?: WorkoutProgramExerciseListRelationFilter
  }

  export type ExerciseOrderByWithRelationInput = {
    id?: SortOrder
    exerciseName?: SortOrder
    typeOfActivity?: SortOrder
    typeOfEquipment?: SortOrder
    bodyPart?: SortOrder
    type?: SortOrder
    muscleGroupsActivated?: SortOrder
    instructions?: SortOrder
    videoUrl?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    workoutExercises?: WorkoutExerciseOrderByRelationAggregateInput
    workoutProgramExercises?: WorkoutProgramExerciseOrderByRelationAggregateInput
  }

  export type ExerciseWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: ExerciseWhereInput | ExerciseWhereInput[]
    OR?: ExerciseWhereInput[]
    NOT?: ExerciseWhereInput | ExerciseWhereInput[]
    exerciseName?: StringFilter<"Exercise"> | string
    typeOfActivity?: EnumExerciseTypeFilter<"Exercise"> | $Enums.ExerciseType
    typeOfEquipment?: EnumEquipmentTypeFilter<"Exercise"> | $Enums.EquipmentType
    bodyPart?: EnumBodyPartFilter<"Exercise"> | $Enums.BodyPart
    type?: EnumMovementTypeFilter<"Exercise"> | $Enums.MovementType
    muscleGroupsActivated?: StringNullableListFilter<"Exercise">
    instructions?: StringFilter<"Exercise"> | string
    videoUrl?: StringNullableFilter<"Exercise"> | string | null
    createdAt?: DateTimeFilter<"Exercise"> | Date | string
    updatedAt?: DateTimeFilter<"Exercise"> | Date | string
    workoutExercises?: WorkoutExerciseListRelationFilter
    workoutProgramExercises?: WorkoutProgramExerciseListRelationFilter
  }, "id">

  export type ExerciseOrderByWithAggregationInput = {
    id?: SortOrder
    exerciseName?: SortOrder
    typeOfActivity?: SortOrder
    typeOfEquipment?: SortOrder
    bodyPart?: SortOrder
    type?: SortOrder
    muscleGroupsActivated?: SortOrder
    instructions?: SortOrder
    videoUrl?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: ExerciseCountOrderByAggregateInput
    _max?: ExerciseMaxOrderByAggregateInput
    _min?: ExerciseMinOrderByAggregateInput
  }

  export type ExerciseScalarWhereWithAggregatesInput = {
    AND?: ExerciseScalarWhereWithAggregatesInput | ExerciseScalarWhereWithAggregatesInput[]
    OR?: ExerciseScalarWhereWithAggregatesInput[]
    NOT?: ExerciseScalarWhereWithAggregatesInput | ExerciseScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"Exercise"> | string
    exerciseName?: StringWithAggregatesFilter<"Exercise"> | string
    typeOfActivity?: EnumExerciseTypeWithAggregatesFilter<"Exercise"> | $Enums.ExerciseType
    typeOfEquipment?: EnumEquipmentTypeWithAggregatesFilter<"Exercise"> | $Enums.EquipmentType
    bodyPart?: EnumBodyPartWithAggregatesFilter<"Exercise"> | $Enums.BodyPart
    type?: EnumMovementTypeWithAggregatesFilter<"Exercise"> | $Enums.MovementType
    muscleGroupsActivated?: StringNullableListFilter<"Exercise">
    instructions?: StringWithAggregatesFilter<"Exercise"> | string
    videoUrl?: StringNullableWithAggregatesFilter<"Exercise"> | string | null
    createdAt?: DateTimeWithAggregatesFilter<"Exercise"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"Exercise"> | Date | string
  }

  export type WorkoutWhereInput = {
    AND?: WorkoutWhereInput | WorkoutWhereInput[]
    OR?: WorkoutWhereInput[]
    NOT?: WorkoutWhereInput | WorkoutWhereInput[]
    id?: StringFilter<"Workout"> | string
    userId?: StringFilter<"Workout"> | string
    name?: StringFilter<"Workout"> | string
    description?: StringNullableFilter<"Workout"> | string | null
    date?: DateTimeFilter<"Workout"> | Date | string
    duration?: IntNullableFilter<"Workout"> | number | null
    notes?: StringNullableFilter<"Workout"> | string | null
    createdAt?: DateTimeFilter<"Workout"> | Date | string
    updatedAt?: DateTimeFilter<"Workout"> | Date | string
    exercises?: WorkoutExerciseListRelationFilter
    schedules?: WorkoutScheduleListRelationFilter
  }

  export type WorkoutOrderByWithRelationInput = {
    id?: SortOrder
    userId?: SortOrder
    name?: SortOrder
    description?: SortOrderInput | SortOrder
    date?: SortOrder
    duration?: SortOrderInput | SortOrder
    notes?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    exercises?: WorkoutExerciseOrderByRelationAggregateInput
    schedules?: WorkoutScheduleOrderByRelationAggregateInput
  }

  export type WorkoutWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: WorkoutWhereInput | WorkoutWhereInput[]
    OR?: WorkoutWhereInput[]
    NOT?: WorkoutWhereInput | WorkoutWhereInput[]
    userId?: StringFilter<"Workout"> | string
    name?: StringFilter<"Workout"> | string
    description?: StringNullableFilter<"Workout"> | string | null
    date?: DateTimeFilter<"Workout"> | Date | string
    duration?: IntNullableFilter<"Workout"> | number | null
    notes?: StringNullableFilter<"Workout"> | string | null
    createdAt?: DateTimeFilter<"Workout"> | Date | string
    updatedAt?: DateTimeFilter<"Workout"> | Date | string
    exercises?: WorkoutExerciseListRelationFilter
    schedules?: WorkoutScheduleListRelationFilter
  }, "id">

  export type WorkoutOrderByWithAggregationInput = {
    id?: SortOrder
    userId?: SortOrder
    name?: SortOrder
    description?: SortOrderInput | SortOrder
    date?: SortOrder
    duration?: SortOrderInput | SortOrder
    notes?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: WorkoutCountOrderByAggregateInput
    _avg?: WorkoutAvgOrderByAggregateInput
    _max?: WorkoutMaxOrderByAggregateInput
    _min?: WorkoutMinOrderByAggregateInput
    _sum?: WorkoutSumOrderByAggregateInput
  }

  export type WorkoutScalarWhereWithAggregatesInput = {
    AND?: WorkoutScalarWhereWithAggregatesInput | WorkoutScalarWhereWithAggregatesInput[]
    OR?: WorkoutScalarWhereWithAggregatesInput[]
    NOT?: WorkoutScalarWhereWithAggregatesInput | WorkoutScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"Workout"> | string
    userId?: StringWithAggregatesFilter<"Workout"> | string
    name?: StringWithAggregatesFilter<"Workout"> | string
    description?: StringNullableWithAggregatesFilter<"Workout"> | string | null
    date?: DateTimeWithAggregatesFilter<"Workout"> | Date | string
    duration?: IntNullableWithAggregatesFilter<"Workout"> | number | null
    notes?: StringNullableWithAggregatesFilter<"Workout"> | string | null
    createdAt?: DateTimeWithAggregatesFilter<"Workout"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"Workout"> | Date | string
  }

  export type WorkoutExerciseWhereInput = {
    AND?: WorkoutExerciseWhereInput | WorkoutExerciseWhereInput[]
    OR?: WorkoutExerciseWhereInput[]
    NOT?: WorkoutExerciseWhereInput | WorkoutExerciseWhereInput[]
    id?: StringFilter<"WorkoutExercise"> | string
    workoutId?: StringFilter<"WorkoutExercise"> | string
    exerciseId?: StringFilter<"WorkoutExercise"> | string
    sets?: IntFilter<"WorkoutExercise"> | number
    reps?: IntNullableFilter<"WorkoutExercise"> | number | null
    duration?: IntNullableFilter<"WorkoutExercise"> | number | null
    weight?: FloatNullableFilter<"WorkoutExercise"> | number | null
    notes?: StringNullableFilter<"WorkoutExercise"> | string | null
    order?: IntFilter<"WorkoutExercise"> | number
    createdAt?: DateTimeFilter<"WorkoutExercise"> | Date | string
    workout?: XOR<WorkoutRelationFilter, WorkoutWhereInput>
    exercise?: XOR<ExerciseRelationFilter, ExerciseWhereInput>
    workoutSets?: WorkoutSetListRelationFilter
  }

  export type WorkoutExerciseOrderByWithRelationInput = {
    id?: SortOrder
    workoutId?: SortOrder
    exerciseId?: SortOrder
    sets?: SortOrder
    reps?: SortOrderInput | SortOrder
    duration?: SortOrderInput | SortOrder
    weight?: SortOrderInput | SortOrder
    notes?: SortOrderInput | SortOrder
    order?: SortOrder
    createdAt?: SortOrder
    workout?: WorkoutOrderByWithRelationInput
    exercise?: ExerciseOrderByWithRelationInput
    workoutSets?: WorkoutSetOrderByRelationAggregateInput
  }

  export type WorkoutExerciseWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: WorkoutExerciseWhereInput | WorkoutExerciseWhereInput[]
    OR?: WorkoutExerciseWhereInput[]
    NOT?: WorkoutExerciseWhereInput | WorkoutExerciseWhereInput[]
    workoutId?: StringFilter<"WorkoutExercise"> | string
    exerciseId?: StringFilter<"WorkoutExercise"> | string
    sets?: IntFilter<"WorkoutExercise"> | number
    reps?: IntNullableFilter<"WorkoutExercise"> | number | null
    duration?: IntNullableFilter<"WorkoutExercise"> | number | null
    weight?: FloatNullableFilter<"WorkoutExercise"> | number | null
    notes?: StringNullableFilter<"WorkoutExercise"> | string | null
    order?: IntFilter<"WorkoutExercise"> | number
    createdAt?: DateTimeFilter<"WorkoutExercise"> | Date | string
    workout?: XOR<WorkoutRelationFilter, WorkoutWhereInput>
    exercise?: XOR<ExerciseRelationFilter, ExerciseWhereInput>
    workoutSets?: WorkoutSetListRelationFilter
  }, "id">

  export type WorkoutExerciseOrderByWithAggregationInput = {
    id?: SortOrder
    workoutId?: SortOrder
    exerciseId?: SortOrder
    sets?: SortOrder
    reps?: SortOrderInput | SortOrder
    duration?: SortOrderInput | SortOrder
    weight?: SortOrderInput | SortOrder
    notes?: SortOrderInput | SortOrder
    order?: SortOrder
    createdAt?: SortOrder
    _count?: WorkoutExerciseCountOrderByAggregateInput
    _avg?: WorkoutExerciseAvgOrderByAggregateInput
    _max?: WorkoutExerciseMaxOrderByAggregateInput
    _min?: WorkoutExerciseMinOrderByAggregateInput
    _sum?: WorkoutExerciseSumOrderByAggregateInput
  }

  export type WorkoutExerciseScalarWhereWithAggregatesInput = {
    AND?: WorkoutExerciseScalarWhereWithAggregatesInput | WorkoutExerciseScalarWhereWithAggregatesInput[]
    OR?: WorkoutExerciseScalarWhereWithAggregatesInput[]
    NOT?: WorkoutExerciseScalarWhereWithAggregatesInput | WorkoutExerciseScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"WorkoutExercise"> | string
    workoutId?: StringWithAggregatesFilter<"WorkoutExercise"> | string
    exerciseId?: StringWithAggregatesFilter<"WorkoutExercise"> | string
    sets?: IntWithAggregatesFilter<"WorkoutExercise"> | number
    reps?: IntNullableWithAggregatesFilter<"WorkoutExercise"> | number | null
    duration?: IntNullableWithAggregatesFilter<"WorkoutExercise"> | number | null
    weight?: FloatNullableWithAggregatesFilter<"WorkoutExercise"> | number | null
    notes?: StringNullableWithAggregatesFilter<"WorkoutExercise"> | string | null
    order?: IntWithAggregatesFilter<"WorkoutExercise"> | number
    createdAt?: DateTimeWithAggregatesFilter<"WorkoutExercise"> | Date | string
  }

  export type WorkoutSetWhereInput = {
    AND?: WorkoutSetWhereInput | WorkoutSetWhereInput[]
    OR?: WorkoutSetWhereInput[]
    NOT?: WorkoutSetWhereInput | WorkoutSetWhereInput[]
    id?: StringFilter<"WorkoutSet"> | string
    workoutExerciseId?: StringFilter<"WorkoutSet"> | string
    setNumber?: IntFilter<"WorkoutSet"> | number
    reps?: IntNullableFilter<"WorkoutSet"> | number | null
    weight?: FloatNullableFilter<"WorkoutSet"> | number | null
    rpe?: FloatNullableFilter<"WorkoutSet"> | number | null
    completed?: BoolFilter<"WorkoutSet"> | boolean
    createdAt?: DateTimeFilter<"WorkoutSet"> | Date | string
    workoutExercise?: XOR<WorkoutExerciseRelationFilter, WorkoutExerciseWhereInput>
  }

  export type WorkoutSetOrderByWithRelationInput = {
    id?: SortOrder
    workoutExerciseId?: SortOrder
    setNumber?: SortOrder
    reps?: SortOrderInput | SortOrder
    weight?: SortOrderInput | SortOrder
    rpe?: SortOrderInput | SortOrder
    completed?: SortOrder
    createdAt?: SortOrder
    workoutExercise?: WorkoutExerciseOrderByWithRelationInput
  }

  export type WorkoutSetWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: WorkoutSetWhereInput | WorkoutSetWhereInput[]
    OR?: WorkoutSetWhereInput[]
    NOT?: WorkoutSetWhereInput | WorkoutSetWhereInput[]
    workoutExerciseId?: StringFilter<"WorkoutSet"> | string
    setNumber?: IntFilter<"WorkoutSet"> | number
    reps?: IntNullableFilter<"WorkoutSet"> | number | null
    weight?: FloatNullableFilter<"WorkoutSet"> | number | null
    rpe?: FloatNullableFilter<"WorkoutSet"> | number | null
    completed?: BoolFilter<"WorkoutSet"> | boolean
    createdAt?: DateTimeFilter<"WorkoutSet"> | Date | string
    workoutExercise?: XOR<WorkoutExerciseRelationFilter, WorkoutExerciseWhereInput>
  }, "id">

  export type WorkoutSetOrderByWithAggregationInput = {
    id?: SortOrder
    workoutExerciseId?: SortOrder
    setNumber?: SortOrder
    reps?: SortOrderInput | SortOrder
    weight?: SortOrderInput | SortOrder
    rpe?: SortOrderInput | SortOrder
    completed?: SortOrder
    createdAt?: SortOrder
    _count?: WorkoutSetCountOrderByAggregateInput
    _avg?: WorkoutSetAvgOrderByAggregateInput
    _max?: WorkoutSetMaxOrderByAggregateInput
    _min?: WorkoutSetMinOrderByAggregateInput
    _sum?: WorkoutSetSumOrderByAggregateInput
  }

  export type WorkoutSetScalarWhereWithAggregatesInput = {
    AND?: WorkoutSetScalarWhereWithAggregatesInput | WorkoutSetScalarWhereWithAggregatesInput[]
    OR?: WorkoutSetScalarWhereWithAggregatesInput[]
    NOT?: WorkoutSetScalarWhereWithAggregatesInput | WorkoutSetScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"WorkoutSet"> | string
    workoutExerciseId?: StringWithAggregatesFilter<"WorkoutSet"> | string
    setNumber?: IntWithAggregatesFilter<"WorkoutSet"> | number
    reps?: IntNullableWithAggregatesFilter<"WorkoutSet"> | number | null
    weight?: FloatNullableWithAggregatesFilter<"WorkoutSet"> | number | null
    rpe?: FloatNullableWithAggregatesFilter<"WorkoutSet"> | number | null
    completed?: BoolWithAggregatesFilter<"WorkoutSet"> | boolean
    createdAt?: DateTimeWithAggregatesFilter<"WorkoutSet"> | Date | string
  }

  export type FoodWhereInput = {
    AND?: FoodWhereInput | FoodWhereInput[]
    OR?: FoodWhereInput[]
    NOT?: FoodWhereInput | FoodWhereInput[]
    id?: StringFilter<"Food"> | string
    fdcId?: IntFilter<"Food"> | number
    name?: StringFilter<"Food"> | string
    calories?: FloatFilter<"Food"> | number
    protein?: FloatFilter<"Food"> | number
    carbs?: FloatFilter<"Food"> | number
    fats?: FloatFilter<"Food"> | number
    source?: StringFilter<"Food"> | string
    imageUrl?: StringNullableFilter<"Food"> | string | null
  }

  export type FoodOrderByWithRelationInput = {
    id?: SortOrder
    fdcId?: SortOrder
    name?: SortOrder
    calories?: SortOrder
    protein?: SortOrder
    carbs?: SortOrder
    fats?: SortOrder
    source?: SortOrder
    imageUrl?: SortOrderInput | SortOrder
  }

  export type FoodWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    fdcId?: number
    AND?: FoodWhereInput | FoodWhereInput[]
    OR?: FoodWhereInput[]
    NOT?: FoodWhereInput | FoodWhereInput[]
    name?: StringFilter<"Food"> | string
    calories?: FloatFilter<"Food"> | number
    protein?: FloatFilter<"Food"> | number
    carbs?: FloatFilter<"Food"> | number
    fats?: FloatFilter<"Food"> | number
    source?: StringFilter<"Food"> | string
    imageUrl?: StringNullableFilter<"Food"> | string | null
  }, "id" | "fdcId">

  export type FoodOrderByWithAggregationInput = {
    id?: SortOrder
    fdcId?: SortOrder
    name?: SortOrder
    calories?: SortOrder
    protein?: SortOrder
    carbs?: SortOrder
    fats?: SortOrder
    source?: SortOrder
    imageUrl?: SortOrderInput | SortOrder
    _count?: FoodCountOrderByAggregateInput
    _avg?: FoodAvgOrderByAggregateInput
    _max?: FoodMaxOrderByAggregateInput
    _min?: FoodMinOrderByAggregateInput
    _sum?: FoodSumOrderByAggregateInput
  }

  export type FoodScalarWhereWithAggregatesInput = {
    AND?: FoodScalarWhereWithAggregatesInput | FoodScalarWhereWithAggregatesInput[]
    OR?: FoodScalarWhereWithAggregatesInput[]
    NOT?: FoodScalarWhereWithAggregatesInput | FoodScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"Food"> | string
    fdcId?: IntWithAggregatesFilter<"Food"> | number
    name?: StringWithAggregatesFilter<"Food"> | string
    calories?: FloatWithAggregatesFilter<"Food"> | number
    protein?: FloatWithAggregatesFilter<"Food"> | number
    carbs?: FloatWithAggregatesFilter<"Food"> | number
    fats?: FloatWithAggregatesFilter<"Food"> | number
    source?: StringWithAggregatesFilter<"Food"> | string
    imageUrl?: StringNullableWithAggregatesFilter<"Food"> | string | null
  }

  export type NutritionLogWhereInput = {
    AND?: NutritionLogWhereInput | NutritionLogWhereInput[]
    OR?: NutritionLogWhereInput[]
    NOT?: NutritionLogWhereInput | NutritionLogWhereInput[]
    id?: StringFilter<"NutritionLog"> | string
    userId?: StringFilter<"NutritionLog"> | string
    date?: DateTimeFilter<"NutritionLog"> | Date | string
    mealType?: StringFilter<"NutritionLog"> | string
    foodName?: StringFilter<"NutritionLog"> | string
    calories?: IntFilter<"NutritionLog"> | number
    protein?: FloatNullableFilter<"NutritionLog"> | number | null
    carbs?: FloatNullableFilter<"NutritionLog"> | number | null
    fats?: FloatNullableFilter<"NutritionLog"> | number | null
    notes?: StringNullableFilter<"NutritionLog"> | string | null
    createdAt?: DateTimeFilter<"NutritionLog"> | Date | string
    updatedAt?: DateTimeFilter<"NutritionLog"> | Date | string
  }

  export type NutritionLogOrderByWithRelationInput = {
    id?: SortOrder
    userId?: SortOrder
    date?: SortOrder
    mealType?: SortOrder
    foodName?: SortOrder
    calories?: SortOrder
    protein?: SortOrderInput | SortOrder
    carbs?: SortOrderInput | SortOrder
    fats?: SortOrderInput | SortOrder
    notes?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type NutritionLogWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: NutritionLogWhereInput | NutritionLogWhereInput[]
    OR?: NutritionLogWhereInput[]
    NOT?: NutritionLogWhereInput | NutritionLogWhereInput[]
    userId?: StringFilter<"NutritionLog"> | string
    date?: DateTimeFilter<"NutritionLog"> | Date | string
    mealType?: StringFilter<"NutritionLog"> | string
    foodName?: StringFilter<"NutritionLog"> | string
    calories?: IntFilter<"NutritionLog"> | number
    protein?: FloatNullableFilter<"NutritionLog"> | number | null
    carbs?: FloatNullableFilter<"NutritionLog"> | number | null
    fats?: FloatNullableFilter<"NutritionLog"> | number | null
    notes?: StringNullableFilter<"NutritionLog"> | string | null
    createdAt?: DateTimeFilter<"NutritionLog"> | Date | string
    updatedAt?: DateTimeFilter<"NutritionLog"> | Date | string
  }, "id">

  export type NutritionLogOrderByWithAggregationInput = {
    id?: SortOrder
    userId?: SortOrder
    date?: SortOrder
    mealType?: SortOrder
    foodName?: SortOrder
    calories?: SortOrder
    protein?: SortOrderInput | SortOrder
    carbs?: SortOrderInput | SortOrder
    fats?: SortOrderInput | SortOrder
    notes?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: NutritionLogCountOrderByAggregateInput
    _avg?: NutritionLogAvgOrderByAggregateInput
    _max?: NutritionLogMaxOrderByAggregateInput
    _min?: NutritionLogMinOrderByAggregateInput
    _sum?: NutritionLogSumOrderByAggregateInput
  }

  export type NutritionLogScalarWhereWithAggregatesInput = {
    AND?: NutritionLogScalarWhereWithAggregatesInput | NutritionLogScalarWhereWithAggregatesInput[]
    OR?: NutritionLogScalarWhereWithAggregatesInput[]
    NOT?: NutritionLogScalarWhereWithAggregatesInput | NutritionLogScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"NutritionLog"> | string
    userId?: StringWithAggregatesFilter<"NutritionLog"> | string
    date?: DateTimeWithAggregatesFilter<"NutritionLog"> | Date | string
    mealType?: StringWithAggregatesFilter<"NutritionLog"> | string
    foodName?: StringWithAggregatesFilter<"NutritionLog"> | string
    calories?: IntWithAggregatesFilter<"NutritionLog"> | number
    protein?: FloatNullableWithAggregatesFilter<"NutritionLog"> | number | null
    carbs?: FloatNullableWithAggregatesFilter<"NutritionLog"> | number | null
    fats?: FloatNullableWithAggregatesFilter<"NutritionLog"> | number | null
    notes?: StringNullableWithAggregatesFilter<"NutritionLog"> | string | null
    createdAt?: DateTimeWithAggregatesFilter<"NutritionLog"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"NutritionLog"> | Date | string
  }

  export type NutritionGoalWhereInput = {
    AND?: NutritionGoalWhereInput | NutritionGoalWhereInput[]
    OR?: NutritionGoalWhereInput[]
    NOT?: NutritionGoalWhereInput | NutritionGoalWhereInput[]
    id?: StringFilter<"NutritionGoal"> | string
    userId?: StringFilter<"NutritionGoal"> | string
    calories?: IntFilter<"NutritionGoal"> | number
    protein?: FloatFilter<"NutritionGoal"> | number
    carbs?: FloatFilter<"NutritionGoal"> | number
    fat?: FloatFilter<"NutritionGoal"> | number
    waterMl?: IntNullableFilter<"NutritionGoal"> | number | null
    createdAt?: DateTimeFilter<"NutritionGoal"> | Date | string
    updatedAt?: DateTimeFilter<"NutritionGoal"> | Date | string
  }

  export type NutritionGoalOrderByWithRelationInput = {
    id?: SortOrder
    userId?: SortOrder
    calories?: SortOrder
    protein?: SortOrder
    carbs?: SortOrder
    fat?: SortOrder
    waterMl?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type NutritionGoalWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    userId?: string
    AND?: NutritionGoalWhereInput | NutritionGoalWhereInput[]
    OR?: NutritionGoalWhereInput[]
    NOT?: NutritionGoalWhereInput | NutritionGoalWhereInput[]
    calories?: IntFilter<"NutritionGoal"> | number
    protein?: FloatFilter<"NutritionGoal"> | number
    carbs?: FloatFilter<"NutritionGoal"> | number
    fat?: FloatFilter<"NutritionGoal"> | number
    waterMl?: IntNullableFilter<"NutritionGoal"> | number | null
    createdAt?: DateTimeFilter<"NutritionGoal"> | Date | string
    updatedAt?: DateTimeFilter<"NutritionGoal"> | Date | string
  }, "id" | "userId">

  export type NutritionGoalOrderByWithAggregationInput = {
    id?: SortOrder
    userId?: SortOrder
    calories?: SortOrder
    protein?: SortOrder
    carbs?: SortOrder
    fat?: SortOrder
    waterMl?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: NutritionGoalCountOrderByAggregateInput
    _avg?: NutritionGoalAvgOrderByAggregateInput
    _max?: NutritionGoalMaxOrderByAggregateInput
    _min?: NutritionGoalMinOrderByAggregateInput
    _sum?: NutritionGoalSumOrderByAggregateInput
  }

  export type NutritionGoalScalarWhereWithAggregatesInput = {
    AND?: NutritionGoalScalarWhereWithAggregatesInput | NutritionGoalScalarWhereWithAggregatesInput[]
    OR?: NutritionGoalScalarWhereWithAggregatesInput[]
    NOT?: NutritionGoalScalarWhereWithAggregatesInput | NutritionGoalScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"NutritionGoal"> | string
    userId?: StringWithAggregatesFilter<"NutritionGoal"> | string
    calories?: IntWithAggregatesFilter<"NutritionGoal"> | number
    protein?: FloatWithAggregatesFilter<"NutritionGoal"> | number
    carbs?: FloatWithAggregatesFilter<"NutritionGoal"> | number
    fat?: FloatWithAggregatesFilter<"NutritionGoal"> | number
    waterMl?: IntNullableWithAggregatesFilter<"NutritionGoal"> | number | null
    createdAt?: DateTimeWithAggregatesFilter<"NutritionGoal"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"NutritionGoal"> | Date | string
  }

  export type BodyMetricsWhereInput = {
    AND?: BodyMetricsWhereInput | BodyMetricsWhereInput[]
    OR?: BodyMetricsWhereInput[]
    NOT?: BodyMetricsWhereInput | BodyMetricsWhereInput[]
    id?: StringFilter<"BodyMetrics"> | string
    userId?: StringFilter<"BodyMetrics"> | string
    date?: DateTimeFilter<"BodyMetrics"> | Date | string
    weight?: FloatNullableFilter<"BodyMetrics"> | number | null
    bodyFat?: FloatNullableFilter<"BodyMetrics"> | number | null
    muscleMass?: FloatNullableFilter<"BodyMetrics"> | number | null
    bodyWater?: FloatNullableFilter<"BodyMetrics"> | number | null
    notes?: StringNullableFilter<"BodyMetrics"> | string | null
    createdAt?: DateTimeFilter<"BodyMetrics"> | Date | string
    updatedAt?: DateTimeFilter<"BodyMetrics"> | Date | string
  }

  export type BodyMetricsOrderByWithRelationInput = {
    id?: SortOrder
    userId?: SortOrder
    date?: SortOrder
    weight?: SortOrderInput | SortOrder
    bodyFat?: SortOrderInput | SortOrder
    muscleMass?: SortOrderInput | SortOrder
    bodyWater?: SortOrderInput | SortOrder
    notes?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type BodyMetricsWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: BodyMetricsWhereInput | BodyMetricsWhereInput[]
    OR?: BodyMetricsWhereInput[]
    NOT?: BodyMetricsWhereInput | BodyMetricsWhereInput[]
    userId?: StringFilter<"BodyMetrics"> | string
    date?: DateTimeFilter<"BodyMetrics"> | Date | string
    weight?: FloatNullableFilter<"BodyMetrics"> | number | null
    bodyFat?: FloatNullableFilter<"BodyMetrics"> | number | null
    muscleMass?: FloatNullableFilter<"BodyMetrics"> | number | null
    bodyWater?: FloatNullableFilter<"BodyMetrics"> | number | null
    notes?: StringNullableFilter<"BodyMetrics"> | string | null
    createdAt?: DateTimeFilter<"BodyMetrics"> | Date | string
    updatedAt?: DateTimeFilter<"BodyMetrics"> | Date | string
  }, "id">

  export type BodyMetricsOrderByWithAggregationInput = {
    id?: SortOrder
    userId?: SortOrder
    date?: SortOrder
    weight?: SortOrderInput | SortOrder
    bodyFat?: SortOrderInput | SortOrder
    muscleMass?: SortOrderInput | SortOrder
    bodyWater?: SortOrderInput | SortOrder
    notes?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: BodyMetricsCountOrderByAggregateInput
    _avg?: BodyMetricsAvgOrderByAggregateInput
    _max?: BodyMetricsMaxOrderByAggregateInput
    _min?: BodyMetricsMinOrderByAggregateInput
    _sum?: BodyMetricsSumOrderByAggregateInput
  }

  export type BodyMetricsScalarWhereWithAggregatesInput = {
    AND?: BodyMetricsScalarWhereWithAggregatesInput | BodyMetricsScalarWhereWithAggregatesInput[]
    OR?: BodyMetricsScalarWhereWithAggregatesInput[]
    NOT?: BodyMetricsScalarWhereWithAggregatesInput | BodyMetricsScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"BodyMetrics"> | string
    userId?: StringWithAggregatesFilter<"BodyMetrics"> | string
    date?: DateTimeWithAggregatesFilter<"BodyMetrics"> | Date | string
    weight?: FloatNullableWithAggregatesFilter<"BodyMetrics"> | number | null
    bodyFat?: FloatNullableWithAggregatesFilter<"BodyMetrics"> | number | null
    muscleMass?: FloatNullableWithAggregatesFilter<"BodyMetrics"> | number | null
    bodyWater?: FloatNullableWithAggregatesFilter<"BodyMetrics"> | number | null
    notes?: StringNullableWithAggregatesFilter<"BodyMetrics"> | string | null
    createdAt?: DateTimeWithAggregatesFilter<"BodyMetrics"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"BodyMetrics"> | Date | string
  }

  export type WorkoutProgramWhereInput = {
    AND?: WorkoutProgramWhereInput | WorkoutProgramWhereInput[]
    OR?: WorkoutProgramWhereInput[]
    NOT?: WorkoutProgramWhereInput | WorkoutProgramWhereInput[]
    id?: StringFilter<"WorkoutProgram"> | string
    userId?: StringFilter<"WorkoutProgram"> | string
    name?: StringFilter<"WorkoutProgram"> | string
    description?: StringNullableFilter<"WorkoutProgram"> | string | null
    createdAt?: DateTimeFilter<"WorkoutProgram"> | Date | string
    updatedAt?: DateTimeFilter<"WorkoutProgram"> | Date | string
    days?: WorkoutProgramDayListRelationFilter
  }

  export type WorkoutProgramOrderByWithRelationInput = {
    id?: SortOrder
    userId?: SortOrder
    name?: SortOrder
    description?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    days?: WorkoutProgramDayOrderByRelationAggregateInput
  }

  export type WorkoutProgramWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: WorkoutProgramWhereInput | WorkoutProgramWhereInput[]
    OR?: WorkoutProgramWhereInput[]
    NOT?: WorkoutProgramWhereInput | WorkoutProgramWhereInput[]
    userId?: StringFilter<"WorkoutProgram"> | string
    name?: StringFilter<"WorkoutProgram"> | string
    description?: StringNullableFilter<"WorkoutProgram"> | string | null
    createdAt?: DateTimeFilter<"WorkoutProgram"> | Date | string
    updatedAt?: DateTimeFilter<"WorkoutProgram"> | Date | string
    days?: WorkoutProgramDayListRelationFilter
  }, "id">

  export type WorkoutProgramOrderByWithAggregationInput = {
    id?: SortOrder
    userId?: SortOrder
    name?: SortOrder
    description?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: WorkoutProgramCountOrderByAggregateInput
    _max?: WorkoutProgramMaxOrderByAggregateInput
    _min?: WorkoutProgramMinOrderByAggregateInput
  }

  export type WorkoutProgramScalarWhereWithAggregatesInput = {
    AND?: WorkoutProgramScalarWhereWithAggregatesInput | WorkoutProgramScalarWhereWithAggregatesInput[]
    OR?: WorkoutProgramScalarWhereWithAggregatesInput[]
    NOT?: WorkoutProgramScalarWhereWithAggregatesInput | WorkoutProgramScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"WorkoutProgram"> | string
    userId?: StringWithAggregatesFilter<"WorkoutProgram"> | string
    name?: StringWithAggregatesFilter<"WorkoutProgram"> | string
    description?: StringNullableWithAggregatesFilter<"WorkoutProgram"> | string | null
    createdAt?: DateTimeWithAggregatesFilter<"WorkoutProgram"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"WorkoutProgram"> | Date | string
  }

  export type WorkoutProgramDayWhereInput = {
    AND?: WorkoutProgramDayWhereInput | WorkoutProgramDayWhereInput[]
    OR?: WorkoutProgramDayWhereInput[]
    NOT?: WorkoutProgramDayWhereInput | WorkoutProgramDayWhereInput[]
    id?: StringFilter<"WorkoutProgramDay"> | string
    programId?: StringFilter<"WorkoutProgramDay"> | string
    dayNumber?: IntFilter<"WorkoutProgramDay"> | number
    title?: StringFilter<"WorkoutProgramDay"> | string
    description?: StringNullableFilter<"WorkoutProgramDay"> | string | null
    duration?: IntNullableFilter<"WorkoutProgramDay"> | number | null
    createdAt?: DateTimeFilter<"WorkoutProgramDay"> | Date | string
    updatedAt?: DateTimeFilter<"WorkoutProgramDay"> | Date | string
    program?: XOR<WorkoutProgramRelationFilter, WorkoutProgramWhereInput>
    exercises?: WorkoutProgramExerciseListRelationFilter
    schedules?: WorkoutScheduleListRelationFilter
  }

  export type WorkoutProgramDayOrderByWithRelationInput = {
    id?: SortOrder
    programId?: SortOrder
    dayNumber?: SortOrder
    title?: SortOrder
    description?: SortOrderInput | SortOrder
    duration?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    program?: WorkoutProgramOrderByWithRelationInput
    exercises?: WorkoutProgramExerciseOrderByRelationAggregateInput
    schedules?: WorkoutScheduleOrderByRelationAggregateInput
  }

  export type WorkoutProgramDayWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    programId_dayNumber?: WorkoutProgramDayProgramIdDayNumberCompoundUniqueInput
    AND?: WorkoutProgramDayWhereInput | WorkoutProgramDayWhereInput[]
    OR?: WorkoutProgramDayWhereInput[]
    NOT?: WorkoutProgramDayWhereInput | WorkoutProgramDayWhereInput[]
    programId?: StringFilter<"WorkoutProgramDay"> | string
    dayNumber?: IntFilter<"WorkoutProgramDay"> | number
    title?: StringFilter<"WorkoutProgramDay"> | string
    description?: StringNullableFilter<"WorkoutProgramDay"> | string | null
    duration?: IntNullableFilter<"WorkoutProgramDay"> | number | null
    createdAt?: DateTimeFilter<"WorkoutProgramDay"> | Date | string
    updatedAt?: DateTimeFilter<"WorkoutProgramDay"> | Date | string
    program?: XOR<WorkoutProgramRelationFilter, WorkoutProgramWhereInput>
    exercises?: WorkoutProgramExerciseListRelationFilter
    schedules?: WorkoutScheduleListRelationFilter
  }, "id" | "programId_dayNumber">

  export type WorkoutProgramDayOrderByWithAggregationInput = {
    id?: SortOrder
    programId?: SortOrder
    dayNumber?: SortOrder
    title?: SortOrder
    description?: SortOrderInput | SortOrder
    duration?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: WorkoutProgramDayCountOrderByAggregateInput
    _avg?: WorkoutProgramDayAvgOrderByAggregateInput
    _max?: WorkoutProgramDayMaxOrderByAggregateInput
    _min?: WorkoutProgramDayMinOrderByAggregateInput
    _sum?: WorkoutProgramDaySumOrderByAggregateInput
  }

  export type WorkoutProgramDayScalarWhereWithAggregatesInput = {
    AND?: WorkoutProgramDayScalarWhereWithAggregatesInput | WorkoutProgramDayScalarWhereWithAggregatesInput[]
    OR?: WorkoutProgramDayScalarWhereWithAggregatesInput[]
    NOT?: WorkoutProgramDayScalarWhereWithAggregatesInput | WorkoutProgramDayScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"WorkoutProgramDay"> | string
    programId?: StringWithAggregatesFilter<"WorkoutProgramDay"> | string
    dayNumber?: IntWithAggregatesFilter<"WorkoutProgramDay"> | number
    title?: StringWithAggregatesFilter<"WorkoutProgramDay"> | string
    description?: StringNullableWithAggregatesFilter<"WorkoutProgramDay"> | string | null
    duration?: IntNullableWithAggregatesFilter<"WorkoutProgramDay"> | number | null
    createdAt?: DateTimeWithAggregatesFilter<"WorkoutProgramDay"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"WorkoutProgramDay"> | Date | string
  }

  export type WorkoutProgramExerciseWhereInput = {
    AND?: WorkoutProgramExerciseWhereInput | WorkoutProgramExerciseWhereInput[]
    OR?: WorkoutProgramExerciseWhereInput[]
    NOT?: WorkoutProgramExerciseWhereInput | WorkoutProgramExerciseWhereInput[]
    id?: StringFilter<"WorkoutProgramExercise"> | string
    programDayId?: StringFilter<"WorkoutProgramExercise"> | string
    exerciseId?: StringFilter<"WorkoutProgramExercise"> | string
    order?: IntFilter<"WorkoutProgramExercise"> | number
    sets?: IntNullableFilter<"WorkoutProgramExercise"> | number | null
    reps?: IntNullableFilter<"WorkoutProgramExercise"> | number | null
    weight?: FloatNullableFilter<"WorkoutProgramExercise"> | number | null
    duration?: IntNullableFilter<"WorkoutProgramExercise"> | number | null
    restSeconds?: IntNullableFilter<"WorkoutProgramExercise"> | number | null
    notes?: StringNullableFilter<"WorkoutProgramExercise"> | string | null
    createdAt?: DateTimeFilter<"WorkoutProgramExercise"> | Date | string
    programDay?: XOR<WorkoutProgramDayRelationFilter, WorkoutProgramDayWhereInput>
    exercise?: XOR<ExerciseRelationFilter, ExerciseWhereInput>
  }

  export type WorkoutProgramExerciseOrderByWithRelationInput = {
    id?: SortOrder
    programDayId?: SortOrder
    exerciseId?: SortOrder
    order?: SortOrder
    sets?: SortOrderInput | SortOrder
    reps?: SortOrderInput | SortOrder
    weight?: SortOrderInput | SortOrder
    duration?: SortOrderInput | SortOrder
    restSeconds?: SortOrderInput | SortOrder
    notes?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    programDay?: WorkoutProgramDayOrderByWithRelationInput
    exercise?: ExerciseOrderByWithRelationInput
  }

  export type WorkoutProgramExerciseWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: WorkoutProgramExerciseWhereInput | WorkoutProgramExerciseWhereInput[]
    OR?: WorkoutProgramExerciseWhereInput[]
    NOT?: WorkoutProgramExerciseWhereInput | WorkoutProgramExerciseWhereInput[]
    programDayId?: StringFilter<"WorkoutProgramExercise"> | string
    exerciseId?: StringFilter<"WorkoutProgramExercise"> | string
    order?: IntFilter<"WorkoutProgramExercise"> | number
    sets?: IntNullableFilter<"WorkoutProgramExercise"> | number | null
    reps?: IntNullableFilter<"WorkoutProgramExercise"> | number | null
    weight?: FloatNullableFilter<"WorkoutProgramExercise"> | number | null
    duration?: IntNullableFilter<"WorkoutProgramExercise"> | number | null
    restSeconds?: IntNullableFilter<"WorkoutProgramExercise"> | number | null
    notes?: StringNullableFilter<"WorkoutProgramExercise"> | string | null
    createdAt?: DateTimeFilter<"WorkoutProgramExercise"> | Date | string
    programDay?: XOR<WorkoutProgramDayRelationFilter, WorkoutProgramDayWhereInput>
    exercise?: XOR<ExerciseRelationFilter, ExerciseWhereInput>
  }, "id">

  export type WorkoutProgramExerciseOrderByWithAggregationInput = {
    id?: SortOrder
    programDayId?: SortOrder
    exerciseId?: SortOrder
    order?: SortOrder
    sets?: SortOrderInput | SortOrder
    reps?: SortOrderInput | SortOrder
    weight?: SortOrderInput | SortOrder
    duration?: SortOrderInput | SortOrder
    restSeconds?: SortOrderInput | SortOrder
    notes?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    _count?: WorkoutProgramExerciseCountOrderByAggregateInput
    _avg?: WorkoutProgramExerciseAvgOrderByAggregateInput
    _max?: WorkoutProgramExerciseMaxOrderByAggregateInput
    _min?: WorkoutProgramExerciseMinOrderByAggregateInput
    _sum?: WorkoutProgramExerciseSumOrderByAggregateInput
  }

  export type WorkoutProgramExerciseScalarWhereWithAggregatesInput = {
    AND?: WorkoutProgramExerciseScalarWhereWithAggregatesInput | WorkoutProgramExerciseScalarWhereWithAggregatesInput[]
    OR?: WorkoutProgramExerciseScalarWhereWithAggregatesInput[]
    NOT?: WorkoutProgramExerciseScalarWhereWithAggregatesInput | WorkoutProgramExerciseScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"WorkoutProgramExercise"> | string
    programDayId?: StringWithAggregatesFilter<"WorkoutProgramExercise"> | string
    exerciseId?: StringWithAggregatesFilter<"WorkoutProgramExercise"> | string
    order?: IntWithAggregatesFilter<"WorkoutProgramExercise"> | number
    sets?: IntNullableWithAggregatesFilter<"WorkoutProgramExercise"> | number | null
    reps?: IntNullableWithAggregatesFilter<"WorkoutProgramExercise"> | number | null
    weight?: FloatNullableWithAggregatesFilter<"WorkoutProgramExercise"> | number | null
    duration?: IntNullableWithAggregatesFilter<"WorkoutProgramExercise"> | number | null
    restSeconds?: IntNullableWithAggregatesFilter<"WorkoutProgramExercise"> | number | null
    notes?: StringNullableWithAggregatesFilter<"WorkoutProgramExercise"> | string | null
    createdAt?: DateTimeWithAggregatesFilter<"WorkoutProgramExercise"> | Date | string
  }

  export type WorkoutScheduleWhereInput = {
    AND?: WorkoutScheduleWhereInput | WorkoutScheduleWhereInput[]
    OR?: WorkoutScheduleWhereInput[]
    NOT?: WorkoutScheduleWhereInput | WorkoutScheduleWhereInput[]
    id?: StringFilter<"WorkoutSchedule"> | string
    userId?: StringFilter<"WorkoutSchedule"> | string
    date?: DateTimeFilter<"WorkoutSchedule"> | Date | string
    programDayId?: StringNullableFilter<"WorkoutSchedule"> | string | null
    workoutId?: StringNullableFilter<"WorkoutSchedule"> | string | null
    notes?: StringNullableFilter<"WorkoutSchedule"> | string | null
    createdAt?: DateTimeFilter<"WorkoutSchedule"> | Date | string
    updatedAt?: DateTimeFilter<"WorkoutSchedule"> | Date | string
    programDay?: XOR<WorkoutProgramDayNullableRelationFilter, WorkoutProgramDayWhereInput> | null
    workout?: XOR<WorkoutNullableRelationFilter, WorkoutWhereInput> | null
  }

  export type WorkoutScheduleOrderByWithRelationInput = {
    id?: SortOrder
    userId?: SortOrder
    date?: SortOrder
    programDayId?: SortOrderInput | SortOrder
    workoutId?: SortOrderInput | SortOrder
    notes?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    programDay?: WorkoutProgramDayOrderByWithRelationInput
    workout?: WorkoutOrderByWithRelationInput
  }

  export type WorkoutScheduleWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    userId_date?: WorkoutScheduleUserIdDateCompoundUniqueInput
    AND?: WorkoutScheduleWhereInput | WorkoutScheduleWhereInput[]
    OR?: WorkoutScheduleWhereInput[]
    NOT?: WorkoutScheduleWhereInput | WorkoutScheduleWhereInput[]
    userId?: StringFilter<"WorkoutSchedule"> | string
    date?: DateTimeFilter<"WorkoutSchedule"> | Date | string
    programDayId?: StringNullableFilter<"WorkoutSchedule"> | string | null
    workoutId?: StringNullableFilter<"WorkoutSchedule"> | string | null
    notes?: StringNullableFilter<"WorkoutSchedule"> | string | null
    createdAt?: DateTimeFilter<"WorkoutSchedule"> | Date | string
    updatedAt?: DateTimeFilter<"WorkoutSchedule"> | Date | string
    programDay?: XOR<WorkoutProgramDayNullableRelationFilter, WorkoutProgramDayWhereInput> | null
    workout?: XOR<WorkoutNullableRelationFilter, WorkoutWhereInput> | null
  }, "id" | "userId_date">

  export type WorkoutScheduleOrderByWithAggregationInput = {
    id?: SortOrder
    userId?: SortOrder
    date?: SortOrder
    programDayId?: SortOrderInput | SortOrder
    workoutId?: SortOrderInput | SortOrder
    notes?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: WorkoutScheduleCountOrderByAggregateInput
    _max?: WorkoutScheduleMaxOrderByAggregateInput
    _min?: WorkoutScheduleMinOrderByAggregateInput
  }

  export type WorkoutScheduleScalarWhereWithAggregatesInput = {
    AND?: WorkoutScheduleScalarWhereWithAggregatesInput | WorkoutScheduleScalarWhereWithAggregatesInput[]
    OR?: WorkoutScheduleScalarWhereWithAggregatesInput[]
    NOT?: WorkoutScheduleScalarWhereWithAggregatesInput | WorkoutScheduleScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"WorkoutSchedule"> | string
    userId?: StringWithAggregatesFilter<"WorkoutSchedule"> | string
    date?: DateTimeWithAggregatesFilter<"WorkoutSchedule"> | Date | string
    programDayId?: StringNullableWithAggregatesFilter<"WorkoutSchedule"> | string | null
    workoutId?: StringNullableWithAggregatesFilter<"WorkoutSchedule"> | string | null
    notes?: StringNullableWithAggregatesFilter<"WorkoutSchedule"> | string | null
    createdAt?: DateTimeWithAggregatesFilter<"WorkoutSchedule"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"WorkoutSchedule"> | Date | string
  }

  export type ExerciseCreateInput = {
    id?: string
    exerciseName: string
    typeOfActivity: $Enums.ExerciseType
    typeOfEquipment: $Enums.EquipmentType
    bodyPart: $Enums.BodyPart
    type: $Enums.MovementType
    muscleGroupsActivated?: ExerciseCreatemuscleGroupsActivatedInput | string[]
    instructions: string
    videoUrl?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    workoutExercises?: WorkoutExerciseCreateNestedManyWithoutExerciseInput
    workoutProgramExercises?: WorkoutProgramExerciseCreateNestedManyWithoutExerciseInput
  }

  export type ExerciseUncheckedCreateInput = {
    id?: string
    exerciseName: string
    typeOfActivity: $Enums.ExerciseType
    typeOfEquipment: $Enums.EquipmentType
    bodyPart: $Enums.BodyPart
    type: $Enums.MovementType
    muscleGroupsActivated?: ExerciseCreatemuscleGroupsActivatedInput | string[]
    instructions: string
    videoUrl?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    workoutExercises?: WorkoutExerciseUncheckedCreateNestedManyWithoutExerciseInput
    workoutProgramExercises?: WorkoutProgramExerciseUncheckedCreateNestedManyWithoutExerciseInput
  }

  export type ExerciseUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    exerciseName?: StringFieldUpdateOperationsInput | string
    typeOfActivity?: EnumExerciseTypeFieldUpdateOperationsInput | $Enums.ExerciseType
    typeOfEquipment?: EnumEquipmentTypeFieldUpdateOperationsInput | $Enums.EquipmentType
    bodyPart?: EnumBodyPartFieldUpdateOperationsInput | $Enums.BodyPart
    type?: EnumMovementTypeFieldUpdateOperationsInput | $Enums.MovementType
    muscleGroupsActivated?: ExerciseUpdatemuscleGroupsActivatedInput | string[]
    instructions?: StringFieldUpdateOperationsInput | string
    videoUrl?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    workoutExercises?: WorkoutExerciseUpdateManyWithoutExerciseNestedInput
    workoutProgramExercises?: WorkoutProgramExerciseUpdateManyWithoutExerciseNestedInput
  }

  export type ExerciseUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    exerciseName?: StringFieldUpdateOperationsInput | string
    typeOfActivity?: EnumExerciseTypeFieldUpdateOperationsInput | $Enums.ExerciseType
    typeOfEquipment?: EnumEquipmentTypeFieldUpdateOperationsInput | $Enums.EquipmentType
    bodyPart?: EnumBodyPartFieldUpdateOperationsInput | $Enums.BodyPart
    type?: EnumMovementTypeFieldUpdateOperationsInput | $Enums.MovementType
    muscleGroupsActivated?: ExerciseUpdatemuscleGroupsActivatedInput | string[]
    instructions?: StringFieldUpdateOperationsInput | string
    videoUrl?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    workoutExercises?: WorkoutExerciseUncheckedUpdateManyWithoutExerciseNestedInput
    workoutProgramExercises?: WorkoutProgramExerciseUncheckedUpdateManyWithoutExerciseNestedInput
  }

  export type ExerciseCreateManyInput = {
    id?: string
    exerciseName: string
    typeOfActivity: $Enums.ExerciseType
    typeOfEquipment: $Enums.EquipmentType
    bodyPart: $Enums.BodyPart
    type: $Enums.MovementType
    muscleGroupsActivated?: ExerciseCreatemuscleGroupsActivatedInput | string[]
    instructions: string
    videoUrl?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type ExerciseUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    exerciseName?: StringFieldUpdateOperationsInput | string
    typeOfActivity?: EnumExerciseTypeFieldUpdateOperationsInput | $Enums.ExerciseType
    typeOfEquipment?: EnumEquipmentTypeFieldUpdateOperationsInput | $Enums.EquipmentType
    bodyPart?: EnumBodyPartFieldUpdateOperationsInput | $Enums.BodyPart
    type?: EnumMovementTypeFieldUpdateOperationsInput | $Enums.MovementType
    muscleGroupsActivated?: ExerciseUpdatemuscleGroupsActivatedInput | string[]
    instructions?: StringFieldUpdateOperationsInput | string
    videoUrl?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ExerciseUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    exerciseName?: StringFieldUpdateOperationsInput | string
    typeOfActivity?: EnumExerciseTypeFieldUpdateOperationsInput | $Enums.ExerciseType
    typeOfEquipment?: EnumEquipmentTypeFieldUpdateOperationsInput | $Enums.EquipmentType
    bodyPart?: EnumBodyPartFieldUpdateOperationsInput | $Enums.BodyPart
    type?: EnumMovementTypeFieldUpdateOperationsInput | $Enums.MovementType
    muscleGroupsActivated?: ExerciseUpdatemuscleGroupsActivatedInput | string[]
    instructions?: StringFieldUpdateOperationsInput | string
    videoUrl?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type WorkoutCreateInput = {
    id?: string
    userId: string
    name: string
    description?: string | null
    date?: Date | string
    duration?: number | null
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    exercises?: WorkoutExerciseCreateNestedManyWithoutWorkoutInput
    schedules?: WorkoutScheduleCreateNestedManyWithoutWorkoutInput
  }

  export type WorkoutUncheckedCreateInput = {
    id?: string
    userId: string
    name: string
    description?: string | null
    date?: Date | string
    duration?: number | null
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    exercises?: WorkoutExerciseUncheckedCreateNestedManyWithoutWorkoutInput
    schedules?: WorkoutScheduleUncheckedCreateNestedManyWithoutWorkoutInput
  }

  export type WorkoutUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    exercises?: WorkoutExerciseUpdateManyWithoutWorkoutNestedInput
    schedules?: WorkoutScheduleUpdateManyWithoutWorkoutNestedInput
  }

  export type WorkoutUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    exercises?: WorkoutExerciseUncheckedUpdateManyWithoutWorkoutNestedInput
    schedules?: WorkoutScheduleUncheckedUpdateManyWithoutWorkoutNestedInput
  }

  export type WorkoutCreateManyInput = {
    id?: string
    userId: string
    name: string
    description?: string | null
    date?: Date | string
    duration?: number | null
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type WorkoutUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type WorkoutUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type WorkoutExerciseCreateInput = {
    id?: string
    sets: number
    reps?: number | null
    duration?: number | null
    weight?: number | null
    notes?: string | null
    order?: number
    createdAt?: Date | string
    workout: WorkoutCreateNestedOneWithoutExercisesInput
    exercise: ExerciseCreateNestedOneWithoutWorkoutExercisesInput
    workoutSets?: WorkoutSetCreateNestedManyWithoutWorkoutExerciseInput
  }

  export type WorkoutExerciseUncheckedCreateInput = {
    id?: string
    workoutId: string
    exerciseId: string
    sets: number
    reps?: number | null
    duration?: number | null
    weight?: number | null
    notes?: string | null
    order?: number
    createdAt?: Date | string
    workoutSets?: WorkoutSetUncheckedCreateNestedManyWithoutWorkoutExerciseInput
  }

  export type WorkoutExerciseUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    sets?: IntFieldUpdateOperationsInput | number
    reps?: NullableIntFieldUpdateOperationsInput | number | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    weight?: NullableFloatFieldUpdateOperationsInput | number | null
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    order?: IntFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    workout?: WorkoutUpdateOneRequiredWithoutExercisesNestedInput
    exercise?: ExerciseUpdateOneRequiredWithoutWorkoutExercisesNestedInput
    workoutSets?: WorkoutSetUpdateManyWithoutWorkoutExerciseNestedInput
  }

  export type WorkoutExerciseUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    workoutId?: StringFieldUpdateOperationsInput | string
    exerciseId?: StringFieldUpdateOperationsInput | string
    sets?: IntFieldUpdateOperationsInput | number
    reps?: NullableIntFieldUpdateOperationsInput | number | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    weight?: NullableFloatFieldUpdateOperationsInput | number | null
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    order?: IntFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    workoutSets?: WorkoutSetUncheckedUpdateManyWithoutWorkoutExerciseNestedInput
  }

  export type WorkoutExerciseCreateManyInput = {
    id?: string
    workoutId: string
    exerciseId: string
    sets: number
    reps?: number | null
    duration?: number | null
    weight?: number | null
    notes?: string | null
    order?: number
    createdAt?: Date | string
  }

  export type WorkoutExerciseUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    sets?: IntFieldUpdateOperationsInput | number
    reps?: NullableIntFieldUpdateOperationsInput | number | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    weight?: NullableFloatFieldUpdateOperationsInput | number | null
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    order?: IntFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type WorkoutExerciseUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    workoutId?: StringFieldUpdateOperationsInput | string
    exerciseId?: StringFieldUpdateOperationsInput | string
    sets?: IntFieldUpdateOperationsInput | number
    reps?: NullableIntFieldUpdateOperationsInput | number | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    weight?: NullableFloatFieldUpdateOperationsInput | number | null
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    order?: IntFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type WorkoutSetCreateInput = {
    id?: string
    setNumber: number
    reps?: number | null
    weight?: number | null
    rpe?: number | null
    completed?: boolean
    createdAt?: Date | string
    workoutExercise: WorkoutExerciseCreateNestedOneWithoutWorkoutSetsInput
  }

  export type WorkoutSetUncheckedCreateInput = {
    id?: string
    workoutExerciseId: string
    setNumber: number
    reps?: number | null
    weight?: number | null
    rpe?: number | null
    completed?: boolean
    createdAt?: Date | string
  }

  export type WorkoutSetUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    setNumber?: IntFieldUpdateOperationsInput | number
    reps?: NullableIntFieldUpdateOperationsInput | number | null
    weight?: NullableFloatFieldUpdateOperationsInput | number | null
    rpe?: NullableFloatFieldUpdateOperationsInput | number | null
    completed?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    workoutExercise?: WorkoutExerciseUpdateOneRequiredWithoutWorkoutSetsNestedInput
  }

  export type WorkoutSetUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    workoutExerciseId?: StringFieldUpdateOperationsInput | string
    setNumber?: IntFieldUpdateOperationsInput | number
    reps?: NullableIntFieldUpdateOperationsInput | number | null
    weight?: NullableFloatFieldUpdateOperationsInput | number | null
    rpe?: NullableFloatFieldUpdateOperationsInput | number | null
    completed?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type WorkoutSetCreateManyInput = {
    id?: string
    workoutExerciseId: string
    setNumber: number
    reps?: number | null
    weight?: number | null
    rpe?: number | null
    completed?: boolean
    createdAt?: Date | string
  }

  export type WorkoutSetUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    setNumber?: IntFieldUpdateOperationsInput | number
    reps?: NullableIntFieldUpdateOperationsInput | number | null
    weight?: NullableFloatFieldUpdateOperationsInput | number | null
    rpe?: NullableFloatFieldUpdateOperationsInput | number | null
    completed?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type WorkoutSetUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    workoutExerciseId?: StringFieldUpdateOperationsInput | string
    setNumber?: IntFieldUpdateOperationsInput | number
    reps?: NullableIntFieldUpdateOperationsInput | number | null
    weight?: NullableFloatFieldUpdateOperationsInput | number | null
    rpe?: NullableFloatFieldUpdateOperationsInput | number | null
    completed?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type FoodCreateInput = {
    id?: string
    fdcId: number
    name: string
    calories: number
    protein?: number
    carbs?: number
    fats?: number
    source: string
    imageUrl?: string | null
  }

  export type FoodUncheckedCreateInput = {
    id?: string
    fdcId: number
    name: string
    calories: number
    protein?: number
    carbs?: number
    fats?: number
    source: string
    imageUrl?: string | null
  }

  export type FoodUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    fdcId?: IntFieldUpdateOperationsInput | number
    name?: StringFieldUpdateOperationsInput | string
    calories?: FloatFieldUpdateOperationsInput | number
    protein?: FloatFieldUpdateOperationsInput | number
    carbs?: FloatFieldUpdateOperationsInput | number
    fats?: FloatFieldUpdateOperationsInput | number
    source?: StringFieldUpdateOperationsInput | string
    imageUrl?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type FoodUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    fdcId?: IntFieldUpdateOperationsInput | number
    name?: StringFieldUpdateOperationsInput | string
    calories?: FloatFieldUpdateOperationsInput | number
    protein?: FloatFieldUpdateOperationsInput | number
    carbs?: FloatFieldUpdateOperationsInput | number
    fats?: FloatFieldUpdateOperationsInput | number
    source?: StringFieldUpdateOperationsInput | string
    imageUrl?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type FoodCreateManyInput = {
    id?: string
    fdcId: number
    name: string
    calories: number
    protein?: number
    carbs?: number
    fats?: number
    source: string
    imageUrl?: string | null
  }

  export type FoodUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    fdcId?: IntFieldUpdateOperationsInput | number
    name?: StringFieldUpdateOperationsInput | string
    calories?: FloatFieldUpdateOperationsInput | number
    protein?: FloatFieldUpdateOperationsInput | number
    carbs?: FloatFieldUpdateOperationsInput | number
    fats?: FloatFieldUpdateOperationsInput | number
    source?: StringFieldUpdateOperationsInput | string
    imageUrl?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type FoodUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    fdcId?: IntFieldUpdateOperationsInput | number
    name?: StringFieldUpdateOperationsInput | string
    calories?: FloatFieldUpdateOperationsInput | number
    protein?: FloatFieldUpdateOperationsInput | number
    carbs?: FloatFieldUpdateOperationsInput | number
    fats?: FloatFieldUpdateOperationsInput | number
    source?: StringFieldUpdateOperationsInput | string
    imageUrl?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type NutritionLogCreateInput = {
    id?: string
    userId: string
    date?: Date | string
    mealType: string
    foodName: string
    calories: number
    protein?: number | null
    carbs?: number | null
    fats?: number | null
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type NutritionLogUncheckedCreateInput = {
    id?: string
    userId: string
    date?: Date | string
    mealType: string
    foodName: string
    calories: number
    protein?: number | null
    carbs?: number | null
    fats?: number | null
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type NutritionLogUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    mealType?: StringFieldUpdateOperationsInput | string
    foodName?: StringFieldUpdateOperationsInput | string
    calories?: IntFieldUpdateOperationsInput | number
    protein?: NullableFloatFieldUpdateOperationsInput | number | null
    carbs?: NullableFloatFieldUpdateOperationsInput | number | null
    fats?: NullableFloatFieldUpdateOperationsInput | number | null
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type NutritionLogUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    mealType?: StringFieldUpdateOperationsInput | string
    foodName?: StringFieldUpdateOperationsInput | string
    calories?: IntFieldUpdateOperationsInput | number
    protein?: NullableFloatFieldUpdateOperationsInput | number | null
    carbs?: NullableFloatFieldUpdateOperationsInput | number | null
    fats?: NullableFloatFieldUpdateOperationsInput | number | null
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type NutritionLogCreateManyInput = {
    id?: string
    userId: string
    date?: Date | string
    mealType: string
    foodName: string
    calories: number
    protein?: number | null
    carbs?: number | null
    fats?: number | null
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type NutritionLogUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    mealType?: StringFieldUpdateOperationsInput | string
    foodName?: StringFieldUpdateOperationsInput | string
    calories?: IntFieldUpdateOperationsInput | number
    protein?: NullableFloatFieldUpdateOperationsInput | number | null
    carbs?: NullableFloatFieldUpdateOperationsInput | number | null
    fats?: NullableFloatFieldUpdateOperationsInput | number | null
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type NutritionLogUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    mealType?: StringFieldUpdateOperationsInput | string
    foodName?: StringFieldUpdateOperationsInput | string
    calories?: IntFieldUpdateOperationsInput | number
    protein?: NullableFloatFieldUpdateOperationsInput | number | null
    carbs?: NullableFloatFieldUpdateOperationsInput | number | null
    fats?: NullableFloatFieldUpdateOperationsInput | number | null
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type NutritionGoalCreateInput = {
    id?: string
    userId: string
    calories?: number
    protein?: number
    carbs?: number
    fat?: number
    waterMl?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type NutritionGoalUncheckedCreateInput = {
    id?: string
    userId: string
    calories?: number
    protein?: number
    carbs?: number
    fat?: number
    waterMl?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type NutritionGoalUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    calories?: IntFieldUpdateOperationsInput | number
    protein?: FloatFieldUpdateOperationsInput | number
    carbs?: FloatFieldUpdateOperationsInput | number
    fat?: FloatFieldUpdateOperationsInput | number
    waterMl?: NullableIntFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type NutritionGoalUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    calories?: IntFieldUpdateOperationsInput | number
    protein?: FloatFieldUpdateOperationsInput | number
    carbs?: FloatFieldUpdateOperationsInput | number
    fat?: FloatFieldUpdateOperationsInput | number
    waterMl?: NullableIntFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type NutritionGoalCreateManyInput = {
    id?: string
    userId: string
    calories?: number
    protein?: number
    carbs?: number
    fat?: number
    waterMl?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type NutritionGoalUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    calories?: IntFieldUpdateOperationsInput | number
    protein?: FloatFieldUpdateOperationsInput | number
    carbs?: FloatFieldUpdateOperationsInput | number
    fat?: FloatFieldUpdateOperationsInput | number
    waterMl?: NullableIntFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type NutritionGoalUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    calories?: IntFieldUpdateOperationsInput | number
    protein?: FloatFieldUpdateOperationsInput | number
    carbs?: FloatFieldUpdateOperationsInput | number
    fat?: FloatFieldUpdateOperationsInput | number
    waterMl?: NullableIntFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type BodyMetricsCreateInput = {
    id?: string
    userId: string
    date?: Date | string
    weight?: number | null
    bodyFat?: number | null
    muscleMass?: number | null
    bodyWater?: number | null
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type BodyMetricsUncheckedCreateInput = {
    id?: string
    userId: string
    date?: Date | string
    weight?: number | null
    bodyFat?: number | null
    muscleMass?: number | null
    bodyWater?: number | null
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type BodyMetricsUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    weight?: NullableFloatFieldUpdateOperationsInput | number | null
    bodyFat?: NullableFloatFieldUpdateOperationsInput | number | null
    muscleMass?: NullableFloatFieldUpdateOperationsInput | number | null
    bodyWater?: NullableFloatFieldUpdateOperationsInput | number | null
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type BodyMetricsUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    weight?: NullableFloatFieldUpdateOperationsInput | number | null
    bodyFat?: NullableFloatFieldUpdateOperationsInput | number | null
    muscleMass?: NullableFloatFieldUpdateOperationsInput | number | null
    bodyWater?: NullableFloatFieldUpdateOperationsInput | number | null
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type BodyMetricsCreateManyInput = {
    id?: string
    userId: string
    date?: Date | string
    weight?: number | null
    bodyFat?: number | null
    muscleMass?: number | null
    bodyWater?: number | null
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type BodyMetricsUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    weight?: NullableFloatFieldUpdateOperationsInput | number | null
    bodyFat?: NullableFloatFieldUpdateOperationsInput | number | null
    muscleMass?: NullableFloatFieldUpdateOperationsInput | number | null
    bodyWater?: NullableFloatFieldUpdateOperationsInput | number | null
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type BodyMetricsUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    weight?: NullableFloatFieldUpdateOperationsInput | number | null
    bodyFat?: NullableFloatFieldUpdateOperationsInput | number | null
    muscleMass?: NullableFloatFieldUpdateOperationsInput | number | null
    bodyWater?: NullableFloatFieldUpdateOperationsInput | number | null
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type WorkoutProgramCreateInput = {
    id?: string
    userId: string
    name: string
    description?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    days?: WorkoutProgramDayCreateNestedManyWithoutProgramInput
  }

  export type WorkoutProgramUncheckedCreateInput = {
    id?: string
    userId: string
    name: string
    description?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    days?: WorkoutProgramDayUncheckedCreateNestedManyWithoutProgramInput
  }

  export type WorkoutProgramUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    days?: WorkoutProgramDayUpdateManyWithoutProgramNestedInput
  }

  export type WorkoutProgramUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    days?: WorkoutProgramDayUncheckedUpdateManyWithoutProgramNestedInput
  }

  export type WorkoutProgramCreateManyInput = {
    id?: string
    userId: string
    name: string
    description?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type WorkoutProgramUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type WorkoutProgramUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type WorkoutProgramDayCreateInput = {
    id?: string
    dayNumber: number
    title: string
    description?: string | null
    duration?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
    program: WorkoutProgramCreateNestedOneWithoutDaysInput
    exercises?: WorkoutProgramExerciseCreateNestedManyWithoutProgramDayInput
    schedules?: WorkoutScheduleCreateNestedManyWithoutProgramDayInput
  }

  export type WorkoutProgramDayUncheckedCreateInput = {
    id?: string
    programId: string
    dayNumber: number
    title: string
    description?: string | null
    duration?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
    exercises?: WorkoutProgramExerciseUncheckedCreateNestedManyWithoutProgramDayInput
    schedules?: WorkoutScheduleUncheckedCreateNestedManyWithoutProgramDayInput
  }

  export type WorkoutProgramDayUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    dayNumber?: IntFieldUpdateOperationsInput | number
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    program?: WorkoutProgramUpdateOneRequiredWithoutDaysNestedInput
    exercises?: WorkoutProgramExerciseUpdateManyWithoutProgramDayNestedInput
    schedules?: WorkoutScheduleUpdateManyWithoutProgramDayNestedInput
  }

  export type WorkoutProgramDayUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    programId?: StringFieldUpdateOperationsInput | string
    dayNumber?: IntFieldUpdateOperationsInput | number
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    exercises?: WorkoutProgramExerciseUncheckedUpdateManyWithoutProgramDayNestedInput
    schedules?: WorkoutScheduleUncheckedUpdateManyWithoutProgramDayNestedInput
  }

  export type WorkoutProgramDayCreateManyInput = {
    id?: string
    programId: string
    dayNumber: number
    title: string
    description?: string | null
    duration?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type WorkoutProgramDayUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    dayNumber?: IntFieldUpdateOperationsInput | number
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type WorkoutProgramDayUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    programId?: StringFieldUpdateOperationsInput | string
    dayNumber?: IntFieldUpdateOperationsInput | number
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type WorkoutProgramExerciseCreateInput = {
    id?: string
    order?: number
    sets?: number | null
    reps?: number | null
    weight?: number | null
    duration?: number | null
    restSeconds?: number | null
    notes?: string | null
    createdAt?: Date | string
    programDay: WorkoutProgramDayCreateNestedOneWithoutExercisesInput
    exercise: ExerciseCreateNestedOneWithoutWorkoutProgramExercisesInput
  }

  export type WorkoutProgramExerciseUncheckedCreateInput = {
    id?: string
    programDayId: string
    exerciseId: string
    order?: number
    sets?: number | null
    reps?: number | null
    weight?: number | null
    duration?: number | null
    restSeconds?: number | null
    notes?: string | null
    createdAt?: Date | string
  }

  export type WorkoutProgramExerciseUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    order?: IntFieldUpdateOperationsInput | number
    sets?: NullableIntFieldUpdateOperationsInput | number | null
    reps?: NullableIntFieldUpdateOperationsInput | number | null
    weight?: NullableFloatFieldUpdateOperationsInput | number | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    restSeconds?: NullableIntFieldUpdateOperationsInput | number | null
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    programDay?: WorkoutProgramDayUpdateOneRequiredWithoutExercisesNestedInput
    exercise?: ExerciseUpdateOneRequiredWithoutWorkoutProgramExercisesNestedInput
  }

  export type WorkoutProgramExerciseUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    programDayId?: StringFieldUpdateOperationsInput | string
    exerciseId?: StringFieldUpdateOperationsInput | string
    order?: IntFieldUpdateOperationsInput | number
    sets?: NullableIntFieldUpdateOperationsInput | number | null
    reps?: NullableIntFieldUpdateOperationsInput | number | null
    weight?: NullableFloatFieldUpdateOperationsInput | number | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    restSeconds?: NullableIntFieldUpdateOperationsInput | number | null
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type WorkoutProgramExerciseCreateManyInput = {
    id?: string
    programDayId: string
    exerciseId: string
    order?: number
    sets?: number | null
    reps?: number | null
    weight?: number | null
    duration?: number | null
    restSeconds?: number | null
    notes?: string | null
    createdAt?: Date | string
  }

  export type WorkoutProgramExerciseUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    order?: IntFieldUpdateOperationsInput | number
    sets?: NullableIntFieldUpdateOperationsInput | number | null
    reps?: NullableIntFieldUpdateOperationsInput | number | null
    weight?: NullableFloatFieldUpdateOperationsInput | number | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    restSeconds?: NullableIntFieldUpdateOperationsInput | number | null
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type WorkoutProgramExerciseUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    programDayId?: StringFieldUpdateOperationsInput | string
    exerciseId?: StringFieldUpdateOperationsInput | string
    order?: IntFieldUpdateOperationsInput | number
    sets?: NullableIntFieldUpdateOperationsInput | number | null
    reps?: NullableIntFieldUpdateOperationsInput | number | null
    weight?: NullableFloatFieldUpdateOperationsInput | number | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    restSeconds?: NullableIntFieldUpdateOperationsInput | number | null
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type WorkoutScheduleCreateInput = {
    id?: string
    userId: string
    date: Date | string
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    programDay?: WorkoutProgramDayCreateNestedOneWithoutSchedulesInput
    workout?: WorkoutCreateNestedOneWithoutSchedulesInput
  }

  export type WorkoutScheduleUncheckedCreateInput = {
    id?: string
    userId: string
    date: Date | string
    programDayId?: string | null
    workoutId?: string | null
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type WorkoutScheduleUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    programDay?: WorkoutProgramDayUpdateOneWithoutSchedulesNestedInput
    workout?: WorkoutUpdateOneWithoutSchedulesNestedInput
  }

  export type WorkoutScheduleUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    programDayId?: NullableStringFieldUpdateOperationsInput | string | null
    workoutId?: NullableStringFieldUpdateOperationsInput | string | null
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type WorkoutScheduleCreateManyInput = {
    id?: string
    userId: string
    date: Date | string
    programDayId?: string | null
    workoutId?: string | null
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type WorkoutScheduleUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type WorkoutScheduleUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    programDayId?: NullableStringFieldUpdateOperationsInput | string | null
    workoutId?: NullableStringFieldUpdateOperationsInput | string | null
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

  export type EnumExerciseTypeFilter<$PrismaModel = never> = {
    equals?: $Enums.ExerciseType | EnumExerciseTypeFieldRefInput<$PrismaModel>
    in?: $Enums.ExerciseType[] | ListEnumExerciseTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.ExerciseType[] | ListEnumExerciseTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumExerciseTypeFilter<$PrismaModel> | $Enums.ExerciseType
  }

  export type EnumEquipmentTypeFilter<$PrismaModel = never> = {
    equals?: $Enums.EquipmentType | EnumEquipmentTypeFieldRefInput<$PrismaModel>
    in?: $Enums.EquipmentType[] | ListEnumEquipmentTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.EquipmentType[] | ListEnumEquipmentTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumEquipmentTypeFilter<$PrismaModel> | $Enums.EquipmentType
  }

  export type EnumBodyPartFilter<$PrismaModel = never> = {
    equals?: $Enums.BodyPart | EnumBodyPartFieldRefInput<$PrismaModel>
    in?: $Enums.BodyPart[] | ListEnumBodyPartFieldRefInput<$PrismaModel>
    notIn?: $Enums.BodyPart[] | ListEnumBodyPartFieldRefInput<$PrismaModel>
    not?: NestedEnumBodyPartFilter<$PrismaModel> | $Enums.BodyPart
  }

  export type EnumMovementTypeFilter<$PrismaModel = never> = {
    equals?: $Enums.MovementType | EnumMovementTypeFieldRefInput<$PrismaModel>
    in?: $Enums.MovementType[] | ListEnumMovementTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.MovementType[] | ListEnumMovementTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumMovementTypeFilter<$PrismaModel> | $Enums.MovementType
  }

  export type StringNullableListFilter<$PrismaModel = never> = {
    equals?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    has?: string | StringFieldRefInput<$PrismaModel> | null
    hasEvery?: string[] | ListStringFieldRefInput<$PrismaModel>
    hasSome?: string[] | ListStringFieldRefInput<$PrismaModel>
    isEmpty?: boolean
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

  export type WorkoutExerciseListRelationFilter = {
    every?: WorkoutExerciseWhereInput
    some?: WorkoutExerciseWhereInput
    none?: WorkoutExerciseWhereInput
  }

  export type WorkoutProgramExerciseListRelationFilter = {
    every?: WorkoutProgramExerciseWhereInput
    some?: WorkoutProgramExerciseWhereInput
    none?: WorkoutProgramExerciseWhereInput
  }

  export type SortOrderInput = {
    sort: SortOrder
    nulls?: NullsOrder
  }

  export type WorkoutExerciseOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type WorkoutProgramExerciseOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type ExerciseCountOrderByAggregateInput = {
    id?: SortOrder
    exerciseName?: SortOrder
    typeOfActivity?: SortOrder
    typeOfEquipment?: SortOrder
    bodyPart?: SortOrder
    type?: SortOrder
    muscleGroupsActivated?: SortOrder
    instructions?: SortOrder
    videoUrl?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type ExerciseMaxOrderByAggregateInput = {
    id?: SortOrder
    exerciseName?: SortOrder
    typeOfActivity?: SortOrder
    typeOfEquipment?: SortOrder
    bodyPart?: SortOrder
    type?: SortOrder
    instructions?: SortOrder
    videoUrl?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type ExerciseMinOrderByAggregateInput = {
    id?: SortOrder
    exerciseName?: SortOrder
    typeOfActivity?: SortOrder
    typeOfEquipment?: SortOrder
    bodyPart?: SortOrder
    type?: SortOrder
    instructions?: SortOrder
    videoUrl?: SortOrder
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

  export type EnumExerciseTypeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.ExerciseType | EnumExerciseTypeFieldRefInput<$PrismaModel>
    in?: $Enums.ExerciseType[] | ListEnumExerciseTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.ExerciseType[] | ListEnumExerciseTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumExerciseTypeWithAggregatesFilter<$PrismaModel> | $Enums.ExerciseType
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumExerciseTypeFilter<$PrismaModel>
    _max?: NestedEnumExerciseTypeFilter<$PrismaModel>
  }

  export type EnumEquipmentTypeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.EquipmentType | EnumEquipmentTypeFieldRefInput<$PrismaModel>
    in?: $Enums.EquipmentType[] | ListEnumEquipmentTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.EquipmentType[] | ListEnumEquipmentTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumEquipmentTypeWithAggregatesFilter<$PrismaModel> | $Enums.EquipmentType
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumEquipmentTypeFilter<$PrismaModel>
    _max?: NestedEnumEquipmentTypeFilter<$PrismaModel>
  }

  export type EnumBodyPartWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.BodyPart | EnumBodyPartFieldRefInput<$PrismaModel>
    in?: $Enums.BodyPart[] | ListEnumBodyPartFieldRefInput<$PrismaModel>
    notIn?: $Enums.BodyPart[] | ListEnumBodyPartFieldRefInput<$PrismaModel>
    not?: NestedEnumBodyPartWithAggregatesFilter<$PrismaModel> | $Enums.BodyPart
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumBodyPartFilter<$PrismaModel>
    _max?: NestedEnumBodyPartFilter<$PrismaModel>
  }

  export type EnumMovementTypeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.MovementType | EnumMovementTypeFieldRefInput<$PrismaModel>
    in?: $Enums.MovementType[] | ListEnumMovementTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.MovementType[] | ListEnumMovementTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumMovementTypeWithAggregatesFilter<$PrismaModel> | $Enums.MovementType
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumMovementTypeFilter<$PrismaModel>
    _max?: NestedEnumMovementTypeFilter<$PrismaModel>
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

  export type WorkoutScheduleListRelationFilter = {
    every?: WorkoutScheduleWhereInput
    some?: WorkoutScheduleWhereInput
    none?: WorkoutScheduleWhereInput
  }

  export type WorkoutScheduleOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type WorkoutCountOrderByAggregateInput = {
    id?: SortOrder
    userId?: SortOrder
    name?: SortOrder
    description?: SortOrder
    date?: SortOrder
    duration?: SortOrder
    notes?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type WorkoutAvgOrderByAggregateInput = {
    duration?: SortOrder
  }

  export type WorkoutMaxOrderByAggregateInput = {
    id?: SortOrder
    userId?: SortOrder
    name?: SortOrder
    description?: SortOrder
    date?: SortOrder
    duration?: SortOrder
    notes?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type WorkoutMinOrderByAggregateInput = {
    id?: SortOrder
    userId?: SortOrder
    name?: SortOrder
    description?: SortOrder
    date?: SortOrder
    duration?: SortOrder
    notes?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type WorkoutSumOrderByAggregateInput = {
    duration?: SortOrder
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

  export type WorkoutRelationFilter = {
    is?: WorkoutWhereInput
    isNot?: WorkoutWhereInput
  }

  export type ExerciseRelationFilter = {
    is?: ExerciseWhereInput
    isNot?: ExerciseWhereInput
  }

  export type WorkoutSetListRelationFilter = {
    every?: WorkoutSetWhereInput
    some?: WorkoutSetWhereInput
    none?: WorkoutSetWhereInput
  }

  export type WorkoutSetOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type WorkoutExerciseCountOrderByAggregateInput = {
    id?: SortOrder
    workoutId?: SortOrder
    exerciseId?: SortOrder
    sets?: SortOrder
    reps?: SortOrder
    duration?: SortOrder
    weight?: SortOrder
    notes?: SortOrder
    order?: SortOrder
    createdAt?: SortOrder
  }

  export type WorkoutExerciseAvgOrderByAggregateInput = {
    sets?: SortOrder
    reps?: SortOrder
    duration?: SortOrder
    weight?: SortOrder
    order?: SortOrder
  }

  export type WorkoutExerciseMaxOrderByAggregateInput = {
    id?: SortOrder
    workoutId?: SortOrder
    exerciseId?: SortOrder
    sets?: SortOrder
    reps?: SortOrder
    duration?: SortOrder
    weight?: SortOrder
    notes?: SortOrder
    order?: SortOrder
    createdAt?: SortOrder
  }

  export type WorkoutExerciseMinOrderByAggregateInput = {
    id?: SortOrder
    workoutId?: SortOrder
    exerciseId?: SortOrder
    sets?: SortOrder
    reps?: SortOrder
    duration?: SortOrder
    weight?: SortOrder
    notes?: SortOrder
    order?: SortOrder
    createdAt?: SortOrder
  }

  export type WorkoutExerciseSumOrderByAggregateInput = {
    sets?: SortOrder
    reps?: SortOrder
    duration?: SortOrder
    weight?: SortOrder
    order?: SortOrder
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

  export type BoolFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolFilter<$PrismaModel> | boolean
  }

  export type WorkoutExerciseRelationFilter = {
    is?: WorkoutExerciseWhereInput
    isNot?: WorkoutExerciseWhereInput
  }

  export type WorkoutSetCountOrderByAggregateInput = {
    id?: SortOrder
    workoutExerciseId?: SortOrder
    setNumber?: SortOrder
    reps?: SortOrder
    weight?: SortOrder
    rpe?: SortOrder
    completed?: SortOrder
    createdAt?: SortOrder
  }

  export type WorkoutSetAvgOrderByAggregateInput = {
    setNumber?: SortOrder
    reps?: SortOrder
    weight?: SortOrder
    rpe?: SortOrder
  }

  export type WorkoutSetMaxOrderByAggregateInput = {
    id?: SortOrder
    workoutExerciseId?: SortOrder
    setNumber?: SortOrder
    reps?: SortOrder
    weight?: SortOrder
    rpe?: SortOrder
    completed?: SortOrder
    createdAt?: SortOrder
  }

  export type WorkoutSetMinOrderByAggregateInput = {
    id?: SortOrder
    workoutExerciseId?: SortOrder
    setNumber?: SortOrder
    reps?: SortOrder
    weight?: SortOrder
    rpe?: SortOrder
    completed?: SortOrder
    createdAt?: SortOrder
  }

  export type WorkoutSetSumOrderByAggregateInput = {
    setNumber?: SortOrder
    reps?: SortOrder
    weight?: SortOrder
    rpe?: SortOrder
  }

  export type BoolWithAggregatesFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolWithAggregatesFilter<$PrismaModel> | boolean
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedBoolFilter<$PrismaModel>
    _max?: NestedBoolFilter<$PrismaModel>
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

  export type FoodCountOrderByAggregateInput = {
    id?: SortOrder
    fdcId?: SortOrder
    name?: SortOrder
    calories?: SortOrder
    protein?: SortOrder
    carbs?: SortOrder
    fats?: SortOrder
    source?: SortOrder
    imageUrl?: SortOrder
  }

  export type FoodAvgOrderByAggregateInput = {
    fdcId?: SortOrder
    calories?: SortOrder
    protein?: SortOrder
    carbs?: SortOrder
    fats?: SortOrder
  }

  export type FoodMaxOrderByAggregateInput = {
    id?: SortOrder
    fdcId?: SortOrder
    name?: SortOrder
    calories?: SortOrder
    protein?: SortOrder
    carbs?: SortOrder
    fats?: SortOrder
    source?: SortOrder
    imageUrl?: SortOrder
  }

  export type FoodMinOrderByAggregateInput = {
    id?: SortOrder
    fdcId?: SortOrder
    name?: SortOrder
    calories?: SortOrder
    protein?: SortOrder
    carbs?: SortOrder
    fats?: SortOrder
    source?: SortOrder
    imageUrl?: SortOrder
  }

  export type FoodSumOrderByAggregateInput = {
    fdcId?: SortOrder
    calories?: SortOrder
    protein?: SortOrder
    carbs?: SortOrder
    fats?: SortOrder
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

  export type NutritionLogCountOrderByAggregateInput = {
    id?: SortOrder
    userId?: SortOrder
    date?: SortOrder
    mealType?: SortOrder
    foodName?: SortOrder
    calories?: SortOrder
    protein?: SortOrder
    carbs?: SortOrder
    fats?: SortOrder
    notes?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type NutritionLogAvgOrderByAggregateInput = {
    calories?: SortOrder
    protein?: SortOrder
    carbs?: SortOrder
    fats?: SortOrder
  }

  export type NutritionLogMaxOrderByAggregateInput = {
    id?: SortOrder
    userId?: SortOrder
    date?: SortOrder
    mealType?: SortOrder
    foodName?: SortOrder
    calories?: SortOrder
    protein?: SortOrder
    carbs?: SortOrder
    fats?: SortOrder
    notes?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type NutritionLogMinOrderByAggregateInput = {
    id?: SortOrder
    userId?: SortOrder
    date?: SortOrder
    mealType?: SortOrder
    foodName?: SortOrder
    calories?: SortOrder
    protein?: SortOrder
    carbs?: SortOrder
    fats?: SortOrder
    notes?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type NutritionLogSumOrderByAggregateInput = {
    calories?: SortOrder
    protein?: SortOrder
    carbs?: SortOrder
    fats?: SortOrder
  }

  export type NutritionGoalCountOrderByAggregateInput = {
    id?: SortOrder
    userId?: SortOrder
    calories?: SortOrder
    protein?: SortOrder
    carbs?: SortOrder
    fat?: SortOrder
    waterMl?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type NutritionGoalAvgOrderByAggregateInput = {
    calories?: SortOrder
    protein?: SortOrder
    carbs?: SortOrder
    fat?: SortOrder
    waterMl?: SortOrder
  }

  export type NutritionGoalMaxOrderByAggregateInput = {
    id?: SortOrder
    userId?: SortOrder
    calories?: SortOrder
    protein?: SortOrder
    carbs?: SortOrder
    fat?: SortOrder
    waterMl?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type NutritionGoalMinOrderByAggregateInput = {
    id?: SortOrder
    userId?: SortOrder
    calories?: SortOrder
    protein?: SortOrder
    carbs?: SortOrder
    fat?: SortOrder
    waterMl?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type NutritionGoalSumOrderByAggregateInput = {
    calories?: SortOrder
    protein?: SortOrder
    carbs?: SortOrder
    fat?: SortOrder
    waterMl?: SortOrder
  }

  export type BodyMetricsCountOrderByAggregateInput = {
    id?: SortOrder
    userId?: SortOrder
    date?: SortOrder
    weight?: SortOrder
    bodyFat?: SortOrder
    muscleMass?: SortOrder
    bodyWater?: SortOrder
    notes?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type BodyMetricsAvgOrderByAggregateInput = {
    weight?: SortOrder
    bodyFat?: SortOrder
    muscleMass?: SortOrder
    bodyWater?: SortOrder
  }

  export type BodyMetricsMaxOrderByAggregateInput = {
    id?: SortOrder
    userId?: SortOrder
    date?: SortOrder
    weight?: SortOrder
    bodyFat?: SortOrder
    muscleMass?: SortOrder
    bodyWater?: SortOrder
    notes?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type BodyMetricsMinOrderByAggregateInput = {
    id?: SortOrder
    userId?: SortOrder
    date?: SortOrder
    weight?: SortOrder
    bodyFat?: SortOrder
    muscleMass?: SortOrder
    bodyWater?: SortOrder
    notes?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type BodyMetricsSumOrderByAggregateInput = {
    weight?: SortOrder
    bodyFat?: SortOrder
    muscleMass?: SortOrder
    bodyWater?: SortOrder
  }

  export type WorkoutProgramDayListRelationFilter = {
    every?: WorkoutProgramDayWhereInput
    some?: WorkoutProgramDayWhereInput
    none?: WorkoutProgramDayWhereInput
  }

  export type WorkoutProgramDayOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type WorkoutProgramCountOrderByAggregateInput = {
    id?: SortOrder
    userId?: SortOrder
    name?: SortOrder
    description?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type WorkoutProgramMaxOrderByAggregateInput = {
    id?: SortOrder
    userId?: SortOrder
    name?: SortOrder
    description?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type WorkoutProgramMinOrderByAggregateInput = {
    id?: SortOrder
    userId?: SortOrder
    name?: SortOrder
    description?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type WorkoutProgramRelationFilter = {
    is?: WorkoutProgramWhereInput
    isNot?: WorkoutProgramWhereInput
  }

  export type WorkoutProgramDayProgramIdDayNumberCompoundUniqueInput = {
    programId: string
    dayNumber: number
  }

  export type WorkoutProgramDayCountOrderByAggregateInput = {
    id?: SortOrder
    programId?: SortOrder
    dayNumber?: SortOrder
    title?: SortOrder
    description?: SortOrder
    duration?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type WorkoutProgramDayAvgOrderByAggregateInput = {
    dayNumber?: SortOrder
    duration?: SortOrder
  }

  export type WorkoutProgramDayMaxOrderByAggregateInput = {
    id?: SortOrder
    programId?: SortOrder
    dayNumber?: SortOrder
    title?: SortOrder
    description?: SortOrder
    duration?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type WorkoutProgramDayMinOrderByAggregateInput = {
    id?: SortOrder
    programId?: SortOrder
    dayNumber?: SortOrder
    title?: SortOrder
    description?: SortOrder
    duration?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type WorkoutProgramDaySumOrderByAggregateInput = {
    dayNumber?: SortOrder
    duration?: SortOrder
  }

  export type WorkoutProgramDayRelationFilter = {
    is?: WorkoutProgramDayWhereInput
    isNot?: WorkoutProgramDayWhereInput
  }

  export type WorkoutProgramExerciseCountOrderByAggregateInput = {
    id?: SortOrder
    programDayId?: SortOrder
    exerciseId?: SortOrder
    order?: SortOrder
    sets?: SortOrder
    reps?: SortOrder
    weight?: SortOrder
    duration?: SortOrder
    restSeconds?: SortOrder
    notes?: SortOrder
    createdAt?: SortOrder
  }

  export type WorkoutProgramExerciseAvgOrderByAggregateInput = {
    order?: SortOrder
    sets?: SortOrder
    reps?: SortOrder
    weight?: SortOrder
    duration?: SortOrder
    restSeconds?: SortOrder
  }

  export type WorkoutProgramExerciseMaxOrderByAggregateInput = {
    id?: SortOrder
    programDayId?: SortOrder
    exerciseId?: SortOrder
    order?: SortOrder
    sets?: SortOrder
    reps?: SortOrder
    weight?: SortOrder
    duration?: SortOrder
    restSeconds?: SortOrder
    notes?: SortOrder
    createdAt?: SortOrder
  }

  export type WorkoutProgramExerciseMinOrderByAggregateInput = {
    id?: SortOrder
    programDayId?: SortOrder
    exerciseId?: SortOrder
    order?: SortOrder
    sets?: SortOrder
    reps?: SortOrder
    weight?: SortOrder
    duration?: SortOrder
    restSeconds?: SortOrder
    notes?: SortOrder
    createdAt?: SortOrder
  }

  export type WorkoutProgramExerciseSumOrderByAggregateInput = {
    order?: SortOrder
    sets?: SortOrder
    reps?: SortOrder
    weight?: SortOrder
    duration?: SortOrder
    restSeconds?: SortOrder
  }

  export type WorkoutProgramDayNullableRelationFilter = {
    is?: WorkoutProgramDayWhereInput | null
    isNot?: WorkoutProgramDayWhereInput | null
  }

  export type WorkoutNullableRelationFilter = {
    is?: WorkoutWhereInput | null
    isNot?: WorkoutWhereInput | null
  }

  export type WorkoutScheduleUserIdDateCompoundUniqueInput = {
    userId: string
    date: Date | string
  }

  export type WorkoutScheduleCountOrderByAggregateInput = {
    id?: SortOrder
    userId?: SortOrder
    date?: SortOrder
    programDayId?: SortOrder
    workoutId?: SortOrder
    notes?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type WorkoutScheduleMaxOrderByAggregateInput = {
    id?: SortOrder
    userId?: SortOrder
    date?: SortOrder
    programDayId?: SortOrder
    workoutId?: SortOrder
    notes?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type WorkoutScheduleMinOrderByAggregateInput = {
    id?: SortOrder
    userId?: SortOrder
    date?: SortOrder
    programDayId?: SortOrder
    workoutId?: SortOrder
    notes?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type ExerciseCreatemuscleGroupsActivatedInput = {
    set: string[]
  }

  export type WorkoutExerciseCreateNestedManyWithoutExerciseInput = {
    create?: XOR<WorkoutExerciseCreateWithoutExerciseInput, WorkoutExerciseUncheckedCreateWithoutExerciseInput> | WorkoutExerciseCreateWithoutExerciseInput[] | WorkoutExerciseUncheckedCreateWithoutExerciseInput[]
    connectOrCreate?: WorkoutExerciseCreateOrConnectWithoutExerciseInput | WorkoutExerciseCreateOrConnectWithoutExerciseInput[]
    createMany?: WorkoutExerciseCreateManyExerciseInputEnvelope
    connect?: WorkoutExerciseWhereUniqueInput | WorkoutExerciseWhereUniqueInput[]
  }

  export type WorkoutProgramExerciseCreateNestedManyWithoutExerciseInput = {
    create?: XOR<WorkoutProgramExerciseCreateWithoutExerciseInput, WorkoutProgramExerciseUncheckedCreateWithoutExerciseInput> | WorkoutProgramExerciseCreateWithoutExerciseInput[] | WorkoutProgramExerciseUncheckedCreateWithoutExerciseInput[]
    connectOrCreate?: WorkoutProgramExerciseCreateOrConnectWithoutExerciseInput | WorkoutProgramExerciseCreateOrConnectWithoutExerciseInput[]
    createMany?: WorkoutProgramExerciseCreateManyExerciseInputEnvelope
    connect?: WorkoutProgramExerciseWhereUniqueInput | WorkoutProgramExerciseWhereUniqueInput[]
  }

  export type WorkoutExerciseUncheckedCreateNestedManyWithoutExerciseInput = {
    create?: XOR<WorkoutExerciseCreateWithoutExerciseInput, WorkoutExerciseUncheckedCreateWithoutExerciseInput> | WorkoutExerciseCreateWithoutExerciseInput[] | WorkoutExerciseUncheckedCreateWithoutExerciseInput[]
    connectOrCreate?: WorkoutExerciseCreateOrConnectWithoutExerciseInput | WorkoutExerciseCreateOrConnectWithoutExerciseInput[]
    createMany?: WorkoutExerciseCreateManyExerciseInputEnvelope
    connect?: WorkoutExerciseWhereUniqueInput | WorkoutExerciseWhereUniqueInput[]
  }

  export type WorkoutProgramExerciseUncheckedCreateNestedManyWithoutExerciseInput = {
    create?: XOR<WorkoutProgramExerciseCreateWithoutExerciseInput, WorkoutProgramExerciseUncheckedCreateWithoutExerciseInput> | WorkoutProgramExerciseCreateWithoutExerciseInput[] | WorkoutProgramExerciseUncheckedCreateWithoutExerciseInput[]
    connectOrCreate?: WorkoutProgramExerciseCreateOrConnectWithoutExerciseInput | WorkoutProgramExerciseCreateOrConnectWithoutExerciseInput[]
    createMany?: WorkoutProgramExerciseCreateManyExerciseInputEnvelope
    connect?: WorkoutProgramExerciseWhereUniqueInput | WorkoutProgramExerciseWhereUniqueInput[]
  }

  export type StringFieldUpdateOperationsInput = {
    set?: string
  }

  export type EnumExerciseTypeFieldUpdateOperationsInput = {
    set?: $Enums.ExerciseType
  }

  export type EnumEquipmentTypeFieldUpdateOperationsInput = {
    set?: $Enums.EquipmentType
  }

  export type EnumBodyPartFieldUpdateOperationsInput = {
    set?: $Enums.BodyPart
  }

  export type EnumMovementTypeFieldUpdateOperationsInput = {
    set?: $Enums.MovementType
  }

  export type ExerciseUpdatemuscleGroupsActivatedInput = {
    set?: string[]
    push?: string | string[]
  }

  export type NullableStringFieldUpdateOperationsInput = {
    set?: string | null
  }

  export type DateTimeFieldUpdateOperationsInput = {
    set?: Date | string
  }

  export type WorkoutExerciseUpdateManyWithoutExerciseNestedInput = {
    create?: XOR<WorkoutExerciseCreateWithoutExerciseInput, WorkoutExerciseUncheckedCreateWithoutExerciseInput> | WorkoutExerciseCreateWithoutExerciseInput[] | WorkoutExerciseUncheckedCreateWithoutExerciseInput[]
    connectOrCreate?: WorkoutExerciseCreateOrConnectWithoutExerciseInput | WorkoutExerciseCreateOrConnectWithoutExerciseInput[]
    upsert?: WorkoutExerciseUpsertWithWhereUniqueWithoutExerciseInput | WorkoutExerciseUpsertWithWhereUniqueWithoutExerciseInput[]
    createMany?: WorkoutExerciseCreateManyExerciseInputEnvelope
    set?: WorkoutExerciseWhereUniqueInput | WorkoutExerciseWhereUniqueInput[]
    disconnect?: WorkoutExerciseWhereUniqueInput | WorkoutExerciseWhereUniqueInput[]
    delete?: WorkoutExerciseWhereUniqueInput | WorkoutExerciseWhereUniqueInput[]
    connect?: WorkoutExerciseWhereUniqueInput | WorkoutExerciseWhereUniqueInput[]
    update?: WorkoutExerciseUpdateWithWhereUniqueWithoutExerciseInput | WorkoutExerciseUpdateWithWhereUniqueWithoutExerciseInput[]
    updateMany?: WorkoutExerciseUpdateManyWithWhereWithoutExerciseInput | WorkoutExerciseUpdateManyWithWhereWithoutExerciseInput[]
    deleteMany?: WorkoutExerciseScalarWhereInput | WorkoutExerciseScalarWhereInput[]
  }

  export type WorkoutProgramExerciseUpdateManyWithoutExerciseNestedInput = {
    create?: XOR<WorkoutProgramExerciseCreateWithoutExerciseInput, WorkoutProgramExerciseUncheckedCreateWithoutExerciseInput> | WorkoutProgramExerciseCreateWithoutExerciseInput[] | WorkoutProgramExerciseUncheckedCreateWithoutExerciseInput[]
    connectOrCreate?: WorkoutProgramExerciseCreateOrConnectWithoutExerciseInput | WorkoutProgramExerciseCreateOrConnectWithoutExerciseInput[]
    upsert?: WorkoutProgramExerciseUpsertWithWhereUniqueWithoutExerciseInput | WorkoutProgramExerciseUpsertWithWhereUniqueWithoutExerciseInput[]
    createMany?: WorkoutProgramExerciseCreateManyExerciseInputEnvelope
    set?: WorkoutProgramExerciseWhereUniqueInput | WorkoutProgramExerciseWhereUniqueInput[]
    disconnect?: WorkoutProgramExerciseWhereUniqueInput | WorkoutProgramExerciseWhereUniqueInput[]
    delete?: WorkoutProgramExerciseWhereUniqueInput | WorkoutProgramExerciseWhereUniqueInput[]
    connect?: WorkoutProgramExerciseWhereUniqueInput | WorkoutProgramExerciseWhereUniqueInput[]
    update?: WorkoutProgramExerciseUpdateWithWhereUniqueWithoutExerciseInput | WorkoutProgramExerciseUpdateWithWhereUniqueWithoutExerciseInput[]
    updateMany?: WorkoutProgramExerciseUpdateManyWithWhereWithoutExerciseInput | WorkoutProgramExerciseUpdateManyWithWhereWithoutExerciseInput[]
    deleteMany?: WorkoutProgramExerciseScalarWhereInput | WorkoutProgramExerciseScalarWhereInput[]
  }

  export type WorkoutExerciseUncheckedUpdateManyWithoutExerciseNestedInput = {
    create?: XOR<WorkoutExerciseCreateWithoutExerciseInput, WorkoutExerciseUncheckedCreateWithoutExerciseInput> | WorkoutExerciseCreateWithoutExerciseInput[] | WorkoutExerciseUncheckedCreateWithoutExerciseInput[]
    connectOrCreate?: WorkoutExerciseCreateOrConnectWithoutExerciseInput | WorkoutExerciseCreateOrConnectWithoutExerciseInput[]
    upsert?: WorkoutExerciseUpsertWithWhereUniqueWithoutExerciseInput | WorkoutExerciseUpsertWithWhereUniqueWithoutExerciseInput[]
    createMany?: WorkoutExerciseCreateManyExerciseInputEnvelope
    set?: WorkoutExerciseWhereUniqueInput | WorkoutExerciseWhereUniqueInput[]
    disconnect?: WorkoutExerciseWhereUniqueInput | WorkoutExerciseWhereUniqueInput[]
    delete?: WorkoutExerciseWhereUniqueInput | WorkoutExerciseWhereUniqueInput[]
    connect?: WorkoutExerciseWhereUniqueInput | WorkoutExerciseWhereUniqueInput[]
    update?: WorkoutExerciseUpdateWithWhereUniqueWithoutExerciseInput | WorkoutExerciseUpdateWithWhereUniqueWithoutExerciseInput[]
    updateMany?: WorkoutExerciseUpdateManyWithWhereWithoutExerciseInput | WorkoutExerciseUpdateManyWithWhereWithoutExerciseInput[]
    deleteMany?: WorkoutExerciseScalarWhereInput | WorkoutExerciseScalarWhereInput[]
  }

  export type WorkoutProgramExerciseUncheckedUpdateManyWithoutExerciseNestedInput = {
    create?: XOR<WorkoutProgramExerciseCreateWithoutExerciseInput, WorkoutProgramExerciseUncheckedCreateWithoutExerciseInput> | WorkoutProgramExerciseCreateWithoutExerciseInput[] | WorkoutProgramExerciseUncheckedCreateWithoutExerciseInput[]
    connectOrCreate?: WorkoutProgramExerciseCreateOrConnectWithoutExerciseInput | WorkoutProgramExerciseCreateOrConnectWithoutExerciseInput[]
    upsert?: WorkoutProgramExerciseUpsertWithWhereUniqueWithoutExerciseInput | WorkoutProgramExerciseUpsertWithWhereUniqueWithoutExerciseInput[]
    createMany?: WorkoutProgramExerciseCreateManyExerciseInputEnvelope
    set?: WorkoutProgramExerciseWhereUniqueInput | WorkoutProgramExerciseWhereUniqueInput[]
    disconnect?: WorkoutProgramExerciseWhereUniqueInput | WorkoutProgramExerciseWhereUniqueInput[]
    delete?: WorkoutProgramExerciseWhereUniqueInput | WorkoutProgramExerciseWhereUniqueInput[]
    connect?: WorkoutProgramExerciseWhereUniqueInput | WorkoutProgramExerciseWhereUniqueInput[]
    update?: WorkoutProgramExerciseUpdateWithWhereUniqueWithoutExerciseInput | WorkoutProgramExerciseUpdateWithWhereUniqueWithoutExerciseInput[]
    updateMany?: WorkoutProgramExerciseUpdateManyWithWhereWithoutExerciseInput | WorkoutProgramExerciseUpdateManyWithWhereWithoutExerciseInput[]
    deleteMany?: WorkoutProgramExerciseScalarWhereInput | WorkoutProgramExerciseScalarWhereInput[]
  }

  export type WorkoutExerciseCreateNestedManyWithoutWorkoutInput = {
    create?: XOR<WorkoutExerciseCreateWithoutWorkoutInput, WorkoutExerciseUncheckedCreateWithoutWorkoutInput> | WorkoutExerciseCreateWithoutWorkoutInput[] | WorkoutExerciseUncheckedCreateWithoutWorkoutInput[]
    connectOrCreate?: WorkoutExerciseCreateOrConnectWithoutWorkoutInput | WorkoutExerciseCreateOrConnectWithoutWorkoutInput[]
    createMany?: WorkoutExerciseCreateManyWorkoutInputEnvelope
    connect?: WorkoutExerciseWhereUniqueInput | WorkoutExerciseWhereUniqueInput[]
  }

  export type WorkoutScheduleCreateNestedManyWithoutWorkoutInput = {
    create?: XOR<WorkoutScheduleCreateWithoutWorkoutInput, WorkoutScheduleUncheckedCreateWithoutWorkoutInput> | WorkoutScheduleCreateWithoutWorkoutInput[] | WorkoutScheduleUncheckedCreateWithoutWorkoutInput[]
    connectOrCreate?: WorkoutScheduleCreateOrConnectWithoutWorkoutInput | WorkoutScheduleCreateOrConnectWithoutWorkoutInput[]
    createMany?: WorkoutScheduleCreateManyWorkoutInputEnvelope
    connect?: WorkoutScheduleWhereUniqueInput | WorkoutScheduleWhereUniqueInput[]
  }

  export type WorkoutExerciseUncheckedCreateNestedManyWithoutWorkoutInput = {
    create?: XOR<WorkoutExerciseCreateWithoutWorkoutInput, WorkoutExerciseUncheckedCreateWithoutWorkoutInput> | WorkoutExerciseCreateWithoutWorkoutInput[] | WorkoutExerciseUncheckedCreateWithoutWorkoutInput[]
    connectOrCreate?: WorkoutExerciseCreateOrConnectWithoutWorkoutInput | WorkoutExerciseCreateOrConnectWithoutWorkoutInput[]
    createMany?: WorkoutExerciseCreateManyWorkoutInputEnvelope
    connect?: WorkoutExerciseWhereUniqueInput | WorkoutExerciseWhereUniqueInput[]
  }

  export type WorkoutScheduleUncheckedCreateNestedManyWithoutWorkoutInput = {
    create?: XOR<WorkoutScheduleCreateWithoutWorkoutInput, WorkoutScheduleUncheckedCreateWithoutWorkoutInput> | WorkoutScheduleCreateWithoutWorkoutInput[] | WorkoutScheduleUncheckedCreateWithoutWorkoutInput[]
    connectOrCreate?: WorkoutScheduleCreateOrConnectWithoutWorkoutInput | WorkoutScheduleCreateOrConnectWithoutWorkoutInput[]
    createMany?: WorkoutScheduleCreateManyWorkoutInputEnvelope
    connect?: WorkoutScheduleWhereUniqueInput | WorkoutScheduleWhereUniqueInput[]
  }

  export type NullableIntFieldUpdateOperationsInput = {
    set?: number | null
    increment?: number
    decrement?: number
    multiply?: number
    divide?: number
  }

  export type WorkoutExerciseUpdateManyWithoutWorkoutNestedInput = {
    create?: XOR<WorkoutExerciseCreateWithoutWorkoutInput, WorkoutExerciseUncheckedCreateWithoutWorkoutInput> | WorkoutExerciseCreateWithoutWorkoutInput[] | WorkoutExerciseUncheckedCreateWithoutWorkoutInput[]
    connectOrCreate?: WorkoutExerciseCreateOrConnectWithoutWorkoutInput | WorkoutExerciseCreateOrConnectWithoutWorkoutInput[]
    upsert?: WorkoutExerciseUpsertWithWhereUniqueWithoutWorkoutInput | WorkoutExerciseUpsertWithWhereUniqueWithoutWorkoutInput[]
    createMany?: WorkoutExerciseCreateManyWorkoutInputEnvelope
    set?: WorkoutExerciseWhereUniqueInput | WorkoutExerciseWhereUniqueInput[]
    disconnect?: WorkoutExerciseWhereUniqueInput | WorkoutExerciseWhereUniqueInput[]
    delete?: WorkoutExerciseWhereUniqueInput | WorkoutExerciseWhereUniqueInput[]
    connect?: WorkoutExerciseWhereUniqueInput | WorkoutExerciseWhereUniqueInput[]
    update?: WorkoutExerciseUpdateWithWhereUniqueWithoutWorkoutInput | WorkoutExerciseUpdateWithWhereUniqueWithoutWorkoutInput[]
    updateMany?: WorkoutExerciseUpdateManyWithWhereWithoutWorkoutInput | WorkoutExerciseUpdateManyWithWhereWithoutWorkoutInput[]
    deleteMany?: WorkoutExerciseScalarWhereInput | WorkoutExerciseScalarWhereInput[]
  }

  export type WorkoutScheduleUpdateManyWithoutWorkoutNestedInput = {
    create?: XOR<WorkoutScheduleCreateWithoutWorkoutInput, WorkoutScheduleUncheckedCreateWithoutWorkoutInput> | WorkoutScheduleCreateWithoutWorkoutInput[] | WorkoutScheduleUncheckedCreateWithoutWorkoutInput[]
    connectOrCreate?: WorkoutScheduleCreateOrConnectWithoutWorkoutInput | WorkoutScheduleCreateOrConnectWithoutWorkoutInput[]
    upsert?: WorkoutScheduleUpsertWithWhereUniqueWithoutWorkoutInput | WorkoutScheduleUpsertWithWhereUniqueWithoutWorkoutInput[]
    createMany?: WorkoutScheduleCreateManyWorkoutInputEnvelope
    set?: WorkoutScheduleWhereUniqueInput | WorkoutScheduleWhereUniqueInput[]
    disconnect?: WorkoutScheduleWhereUniqueInput | WorkoutScheduleWhereUniqueInput[]
    delete?: WorkoutScheduleWhereUniqueInput | WorkoutScheduleWhereUniqueInput[]
    connect?: WorkoutScheduleWhereUniqueInput | WorkoutScheduleWhereUniqueInput[]
    update?: WorkoutScheduleUpdateWithWhereUniqueWithoutWorkoutInput | WorkoutScheduleUpdateWithWhereUniqueWithoutWorkoutInput[]
    updateMany?: WorkoutScheduleUpdateManyWithWhereWithoutWorkoutInput | WorkoutScheduleUpdateManyWithWhereWithoutWorkoutInput[]
    deleteMany?: WorkoutScheduleScalarWhereInput | WorkoutScheduleScalarWhereInput[]
  }

  export type WorkoutExerciseUncheckedUpdateManyWithoutWorkoutNestedInput = {
    create?: XOR<WorkoutExerciseCreateWithoutWorkoutInput, WorkoutExerciseUncheckedCreateWithoutWorkoutInput> | WorkoutExerciseCreateWithoutWorkoutInput[] | WorkoutExerciseUncheckedCreateWithoutWorkoutInput[]
    connectOrCreate?: WorkoutExerciseCreateOrConnectWithoutWorkoutInput | WorkoutExerciseCreateOrConnectWithoutWorkoutInput[]
    upsert?: WorkoutExerciseUpsertWithWhereUniqueWithoutWorkoutInput | WorkoutExerciseUpsertWithWhereUniqueWithoutWorkoutInput[]
    createMany?: WorkoutExerciseCreateManyWorkoutInputEnvelope
    set?: WorkoutExerciseWhereUniqueInput | WorkoutExerciseWhereUniqueInput[]
    disconnect?: WorkoutExerciseWhereUniqueInput | WorkoutExerciseWhereUniqueInput[]
    delete?: WorkoutExerciseWhereUniqueInput | WorkoutExerciseWhereUniqueInput[]
    connect?: WorkoutExerciseWhereUniqueInput | WorkoutExerciseWhereUniqueInput[]
    update?: WorkoutExerciseUpdateWithWhereUniqueWithoutWorkoutInput | WorkoutExerciseUpdateWithWhereUniqueWithoutWorkoutInput[]
    updateMany?: WorkoutExerciseUpdateManyWithWhereWithoutWorkoutInput | WorkoutExerciseUpdateManyWithWhereWithoutWorkoutInput[]
    deleteMany?: WorkoutExerciseScalarWhereInput | WorkoutExerciseScalarWhereInput[]
  }

  export type WorkoutScheduleUncheckedUpdateManyWithoutWorkoutNestedInput = {
    create?: XOR<WorkoutScheduleCreateWithoutWorkoutInput, WorkoutScheduleUncheckedCreateWithoutWorkoutInput> | WorkoutScheduleCreateWithoutWorkoutInput[] | WorkoutScheduleUncheckedCreateWithoutWorkoutInput[]
    connectOrCreate?: WorkoutScheduleCreateOrConnectWithoutWorkoutInput | WorkoutScheduleCreateOrConnectWithoutWorkoutInput[]
    upsert?: WorkoutScheduleUpsertWithWhereUniqueWithoutWorkoutInput | WorkoutScheduleUpsertWithWhereUniqueWithoutWorkoutInput[]
    createMany?: WorkoutScheduleCreateManyWorkoutInputEnvelope
    set?: WorkoutScheduleWhereUniqueInput | WorkoutScheduleWhereUniqueInput[]
    disconnect?: WorkoutScheduleWhereUniqueInput | WorkoutScheduleWhereUniqueInput[]
    delete?: WorkoutScheduleWhereUniqueInput | WorkoutScheduleWhereUniqueInput[]
    connect?: WorkoutScheduleWhereUniqueInput | WorkoutScheduleWhereUniqueInput[]
    update?: WorkoutScheduleUpdateWithWhereUniqueWithoutWorkoutInput | WorkoutScheduleUpdateWithWhereUniqueWithoutWorkoutInput[]
    updateMany?: WorkoutScheduleUpdateManyWithWhereWithoutWorkoutInput | WorkoutScheduleUpdateManyWithWhereWithoutWorkoutInput[]
    deleteMany?: WorkoutScheduleScalarWhereInput | WorkoutScheduleScalarWhereInput[]
  }

  export type WorkoutCreateNestedOneWithoutExercisesInput = {
    create?: XOR<WorkoutCreateWithoutExercisesInput, WorkoutUncheckedCreateWithoutExercisesInput>
    connectOrCreate?: WorkoutCreateOrConnectWithoutExercisesInput
    connect?: WorkoutWhereUniqueInput
  }

  export type ExerciseCreateNestedOneWithoutWorkoutExercisesInput = {
    create?: XOR<ExerciseCreateWithoutWorkoutExercisesInput, ExerciseUncheckedCreateWithoutWorkoutExercisesInput>
    connectOrCreate?: ExerciseCreateOrConnectWithoutWorkoutExercisesInput
    connect?: ExerciseWhereUniqueInput
  }

  export type WorkoutSetCreateNestedManyWithoutWorkoutExerciseInput = {
    create?: XOR<WorkoutSetCreateWithoutWorkoutExerciseInput, WorkoutSetUncheckedCreateWithoutWorkoutExerciseInput> | WorkoutSetCreateWithoutWorkoutExerciseInput[] | WorkoutSetUncheckedCreateWithoutWorkoutExerciseInput[]
    connectOrCreate?: WorkoutSetCreateOrConnectWithoutWorkoutExerciseInput | WorkoutSetCreateOrConnectWithoutWorkoutExerciseInput[]
    createMany?: WorkoutSetCreateManyWorkoutExerciseInputEnvelope
    connect?: WorkoutSetWhereUniqueInput | WorkoutSetWhereUniqueInput[]
  }

  export type WorkoutSetUncheckedCreateNestedManyWithoutWorkoutExerciseInput = {
    create?: XOR<WorkoutSetCreateWithoutWorkoutExerciseInput, WorkoutSetUncheckedCreateWithoutWorkoutExerciseInput> | WorkoutSetCreateWithoutWorkoutExerciseInput[] | WorkoutSetUncheckedCreateWithoutWorkoutExerciseInput[]
    connectOrCreate?: WorkoutSetCreateOrConnectWithoutWorkoutExerciseInput | WorkoutSetCreateOrConnectWithoutWorkoutExerciseInput[]
    createMany?: WorkoutSetCreateManyWorkoutExerciseInputEnvelope
    connect?: WorkoutSetWhereUniqueInput | WorkoutSetWhereUniqueInput[]
  }

  export type IntFieldUpdateOperationsInput = {
    set?: number
    increment?: number
    decrement?: number
    multiply?: number
    divide?: number
  }

  export type NullableFloatFieldUpdateOperationsInput = {
    set?: number | null
    increment?: number
    decrement?: number
    multiply?: number
    divide?: number
  }

  export type WorkoutUpdateOneRequiredWithoutExercisesNestedInput = {
    create?: XOR<WorkoutCreateWithoutExercisesInput, WorkoutUncheckedCreateWithoutExercisesInput>
    connectOrCreate?: WorkoutCreateOrConnectWithoutExercisesInput
    upsert?: WorkoutUpsertWithoutExercisesInput
    connect?: WorkoutWhereUniqueInput
    update?: XOR<XOR<WorkoutUpdateToOneWithWhereWithoutExercisesInput, WorkoutUpdateWithoutExercisesInput>, WorkoutUncheckedUpdateWithoutExercisesInput>
  }

  export type ExerciseUpdateOneRequiredWithoutWorkoutExercisesNestedInput = {
    create?: XOR<ExerciseCreateWithoutWorkoutExercisesInput, ExerciseUncheckedCreateWithoutWorkoutExercisesInput>
    connectOrCreate?: ExerciseCreateOrConnectWithoutWorkoutExercisesInput
    upsert?: ExerciseUpsertWithoutWorkoutExercisesInput
    connect?: ExerciseWhereUniqueInput
    update?: XOR<XOR<ExerciseUpdateToOneWithWhereWithoutWorkoutExercisesInput, ExerciseUpdateWithoutWorkoutExercisesInput>, ExerciseUncheckedUpdateWithoutWorkoutExercisesInput>
  }

  export type WorkoutSetUpdateManyWithoutWorkoutExerciseNestedInput = {
    create?: XOR<WorkoutSetCreateWithoutWorkoutExerciseInput, WorkoutSetUncheckedCreateWithoutWorkoutExerciseInput> | WorkoutSetCreateWithoutWorkoutExerciseInput[] | WorkoutSetUncheckedCreateWithoutWorkoutExerciseInput[]
    connectOrCreate?: WorkoutSetCreateOrConnectWithoutWorkoutExerciseInput | WorkoutSetCreateOrConnectWithoutWorkoutExerciseInput[]
    upsert?: WorkoutSetUpsertWithWhereUniqueWithoutWorkoutExerciseInput | WorkoutSetUpsertWithWhereUniqueWithoutWorkoutExerciseInput[]
    createMany?: WorkoutSetCreateManyWorkoutExerciseInputEnvelope
    set?: WorkoutSetWhereUniqueInput | WorkoutSetWhereUniqueInput[]
    disconnect?: WorkoutSetWhereUniqueInput | WorkoutSetWhereUniqueInput[]
    delete?: WorkoutSetWhereUniqueInput | WorkoutSetWhereUniqueInput[]
    connect?: WorkoutSetWhereUniqueInput | WorkoutSetWhereUniqueInput[]
    update?: WorkoutSetUpdateWithWhereUniqueWithoutWorkoutExerciseInput | WorkoutSetUpdateWithWhereUniqueWithoutWorkoutExerciseInput[]
    updateMany?: WorkoutSetUpdateManyWithWhereWithoutWorkoutExerciseInput | WorkoutSetUpdateManyWithWhereWithoutWorkoutExerciseInput[]
    deleteMany?: WorkoutSetScalarWhereInput | WorkoutSetScalarWhereInput[]
  }

  export type WorkoutSetUncheckedUpdateManyWithoutWorkoutExerciseNestedInput = {
    create?: XOR<WorkoutSetCreateWithoutWorkoutExerciseInput, WorkoutSetUncheckedCreateWithoutWorkoutExerciseInput> | WorkoutSetCreateWithoutWorkoutExerciseInput[] | WorkoutSetUncheckedCreateWithoutWorkoutExerciseInput[]
    connectOrCreate?: WorkoutSetCreateOrConnectWithoutWorkoutExerciseInput | WorkoutSetCreateOrConnectWithoutWorkoutExerciseInput[]
    upsert?: WorkoutSetUpsertWithWhereUniqueWithoutWorkoutExerciseInput | WorkoutSetUpsertWithWhereUniqueWithoutWorkoutExerciseInput[]
    createMany?: WorkoutSetCreateManyWorkoutExerciseInputEnvelope
    set?: WorkoutSetWhereUniqueInput | WorkoutSetWhereUniqueInput[]
    disconnect?: WorkoutSetWhereUniqueInput | WorkoutSetWhereUniqueInput[]
    delete?: WorkoutSetWhereUniqueInput | WorkoutSetWhereUniqueInput[]
    connect?: WorkoutSetWhereUniqueInput | WorkoutSetWhereUniqueInput[]
    update?: WorkoutSetUpdateWithWhereUniqueWithoutWorkoutExerciseInput | WorkoutSetUpdateWithWhereUniqueWithoutWorkoutExerciseInput[]
    updateMany?: WorkoutSetUpdateManyWithWhereWithoutWorkoutExerciseInput | WorkoutSetUpdateManyWithWhereWithoutWorkoutExerciseInput[]
    deleteMany?: WorkoutSetScalarWhereInput | WorkoutSetScalarWhereInput[]
  }

  export type WorkoutExerciseCreateNestedOneWithoutWorkoutSetsInput = {
    create?: XOR<WorkoutExerciseCreateWithoutWorkoutSetsInput, WorkoutExerciseUncheckedCreateWithoutWorkoutSetsInput>
    connectOrCreate?: WorkoutExerciseCreateOrConnectWithoutWorkoutSetsInput
    connect?: WorkoutExerciseWhereUniqueInput
  }

  export type BoolFieldUpdateOperationsInput = {
    set?: boolean
  }

  export type WorkoutExerciseUpdateOneRequiredWithoutWorkoutSetsNestedInput = {
    create?: XOR<WorkoutExerciseCreateWithoutWorkoutSetsInput, WorkoutExerciseUncheckedCreateWithoutWorkoutSetsInput>
    connectOrCreate?: WorkoutExerciseCreateOrConnectWithoutWorkoutSetsInput
    upsert?: WorkoutExerciseUpsertWithoutWorkoutSetsInput
    connect?: WorkoutExerciseWhereUniqueInput
    update?: XOR<XOR<WorkoutExerciseUpdateToOneWithWhereWithoutWorkoutSetsInput, WorkoutExerciseUpdateWithoutWorkoutSetsInput>, WorkoutExerciseUncheckedUpdateWithoutWorkoutSetsInput>
  }

  export type FloatFieldUpdateOperationsInput = {
    set?: number
    increment?: number
    decrement?: number
    multiply?: number
    divide?: number
  }

  export type WorkoutProgramDayCreateNestedManyWithoutProgramInput = {
    create?: XOR<WorkoutProgramDayCreateWithoutProgramInput, WorkoutProgramDayUncheckedCreateWithoutProgramInput> | WorkoutProgramDayCreateWithoutProgramInput[] | WorkoutProgramDayUncheckedCreateWithoutProgramInput[]
    connectOrCreate?: WorkoutProgramDayCreateOrConnectWithoutProgramInput | WorkoutProgramDayCreateOrConnectWithoutProgramInput[]
    createMany?: WorkoutProgramDayCreateManyProgramInputEnvelope
    connect?: WorkoutProgramDayWhereUniqueInput | WorkoutProgramDayWhereUniqueInput[]
  }

  export type WorkoutProgramDayUncheckedCreateNestedManyWithoutProgramInput = {
    create?: XOR<WorkoutProgramDayCreateWithoutProgramInput, WorkoutProgramDayUncheckedCreateWithoutProgramInput> | WorkoutProgramDayCreateWithoutProgramInput[] | WorkoutProgramDayUncheckedCreateWithoutProgramInput[]
    connectOrCreate?: WorkoutProgramDayCreateOrConnectWithoutProgramInput | WorkoutProgramDayCreateOrConnectWithoutProgramInput[]
    createMany?: WorkoutProgramDayCreateManyProgramInputEnvelope
    connect?: WorkoutProgramDayWhereUniqueInput | WorkoutProgramDayWhereUniqueInput[]
  }

  export type WorkoutProgramDayUpdateManyWithoutProgramNestedInput = {
    create?: XOR<WorkoutProgramDayCreateWithoutProgramInput, WorkoutProgramDayUncheckedCreateWithoutProgramInput> | WorkoutProgramDayCreateWithoutProgramInput[] | WorkoutProgramDayUncheckedCreateWithoutProgramInput[]
    connectOrCreate?: WorkoutProgramDayCreateOrConnectWithoutProgramInput | WorkoutProgramDayCreateOrConnectWithoutProgramInput[]
    upsert?: WorkoutProgramDayUpsertWithWhereUniqueWithoutProgramInput | WorkoutProgramDayUpsertWithWhereUniqueWithoutProgramInput[]
    createMany?: WorkoutProgramDayCreateManyProgramInputEnvelope
    set?: WorkoutProgramDayWhereUniqueInput | WorkoutProgramDayWhereUniqueInput[]
    disconnect?: WorkoutProgramDayWhereUniqueInput | WorkoutProgramDayWhereUniqueInput[]
    delete?: WorkoutProgramDayWhereUniqueInput | WorkoutProgramDayWhereUniqueInput[]
    connect?: WorkoutProgramDayWhereUniqueInput | WorkoutProgramDayWhereUniqueInput[]
    update?: WorkoutProgramDayUpdateWithWhereUniqueWithoutProgramInput | WorkoutProgramDayUpdateWithWhereUniqueWithoutProgramInput[]
    updateMany?: WorkoutProgramDayUpdateManyWithWhereWithoutProgramInput | WorkoutProgramDayUpdateManyWithWhereWithoutProgramInput[]
    deleteMany?: WorkoutProgramDayScalarWhereInput | WorkoutProgramDayScalarWhereInput[]
  }

  export type WorkoutProgramDayUncheckedUpdateManyWithoutProgramNestedInput = {
    create?: XOR<WorkoutProgramDayCreateWithoutProgramInput, WorkoutProgramDayUncheckedCreateWithoutProgramInput> | WorkoutProgramDayCreateWithoutProgramInput[] | WorkoutProgramDayUncheckedCreateWithoutProgramInput[]
    connectOrCreate?: WorkoutProgramDayCreateOrConnectWithoutProgramInput | WorkoutProgramDayCreateOrConnectWithoutProgramInput[]
    upsert?: WorkoutProgramDayUpsertWithWhereUniqueWithoutProgramInput | WorkoutProgramDayUpsertWithWhereUniqueWithoutProgramInput[]
    createMany?: WorkoutProgramDayCreateManyProgramInputEnvelope
    set?: WorkoutProgramDayWhereUniqueInput | WorkoutProgramDayWhereUniqueInput[]
    disconnect?: WorkoutProgramDayWhereUniqueInput | WorkoutProgramDayWhereUniqueInput[]
    delete?: WorkoutProgramDayWhereUniqueInput | WorkoutProgramDayWhereUniqueInput[]
    connect?: WorkoutProgramDayWhereUniqueInput | WorkoutProgramDayWhereUniqueInput[]
    update?: WorkoutProgramDayUpdateWithWhereUniqueWithoutProgramInput | WorkoutProgramDayUpdateWithWhereUniqueWithoutProgramInput[]
    updateMany?: WorkoutProgramDayUpdateManyWithWhereWithoutProgramInput | WorkoutProgramDayUpdateManyWithWhereWithoutProgramInput[]
    deleteMany?: WorkoutProgramDayScalarWhereInput | WorkoutProgramDayScalarWhereInput[]
  }

  export type WorkoutProgramCreateNestedOneWithoutDaysInput = {
    create?: XOR<WorkoutProgramCreateWithoutDaysInput, WorkoutProgramUncheckedCreateWithoutDaysInput>
    connectOrCreate?: WorkoutProgramCreateOrConnectWithoutDaysInput
    connect?: WorkoutProgramWhereUniqueInput
  }

  export type WorkoutProgramExerciseCreateNestedManyWithoutProgramDayInput = {
    create?: XOR<WorkoutProgramExerciseCreateWithoutProgramDayInput, WorkoutProgramExerciseUncheckedCreateWithoutProgramDayInput> | WorkoutProgramExerciseCreateWithoutProgramDayInput[] | WorkoutProgramExerciseUncheckedCreateWithoutProgramDayInput[]
    connectOrCreate?: WorkoutProgramExerciseCreateOrConnectWithoutProgramDayInput | WorkoutProgramExerciseCreateOrConnectWithoutProgramDayInput[]
    createMany?: WorkoutProgramExerciseCreateManyProgramDayInputEnvelope
    connect?: WorkoutProgramExerciseWhereUniqueInput | WorkoutProgramExerciseWhereUniqueInput[]
  }

  export type WorkoutScheduleCreateNestedManyWithoutProgramDayInput = {
    create?: XOR<WorkoutScheduleCreateWithoutProgramDayInput, WorkoutScheduleUncheckedCreateWithoutProgramDayInput> | WorkoutScheduleCreateWithoutProgramDayInput[] | WorkoutScheduleUncheckedCreateWithoutProgramDayInput[]
    connectOrCreate?: WorkoutScheduleCreateOrConnectWithoutProgramDayInput | WorkoutScheduleCreateOrConnectWithoutProgramDayInput[]
    createMany?: WorkoutScheduleCreateManyProgramDayInputEnvelope
    connect?: WorkoutScheduleWhereUniqueInput | WorkoutScheduleWhereUniqueInput[]
  }

  export type WorkoutProgramExerciseUncheckedCreateNestedManyWithoutProgramDayInput = {
    create?: XOR<WorkoutProgramExerciseCreateWithoutProgramDayInput, WorkoutProgramExerciseUncheckedCreateWithoutProgramDayInput> | WorkoutProgramExerciseCreateWithoutProgramDayInput[] | WorkoutProgramExerciseUncheckedCreateWithoutProgramDayInput[]
    connectOrCreate?: WorkoutProgramExerciseCreateOrConnectWithoutProgramDayInput | WorkoutProgramExerciseCreateOrConnectWithoutProgramDayInput[]
    createMany?: WorkoutProgramExerciseCreateManyProgramDayInputEnvelope
    connect?: WorkoutProgramExerciseWhereUniqueInput | WorkoutProgramExerciseWhereUniqueInput[]
  }

  export type WorkoutScheduleUncheckedCreateNestedManyWithoutProgramDayInput = {
    create?: XOR<WorkoutScheduleCreateWithoutProgramDayInput, WorkoutScheduleUncheckedCreateWithoutProgramDayInput> | WorkoutScheduleCreateWithoutProgramDayInput[] | WorkoutScheduleUncheckedCreateWithoutProgramDayInput[]
    connectOrCreate?: WorkoutScheduleCreateOrConnectWithoutProgramDayInput | WorkoutScheduleCreateOrConnectWithoutProgramDayInput[]
    createMany?: WorkoutScheduleCreateManyProgramDayInputEnvelope
    connect?: WorkoutScheduleWhereUniqueInput | WorkoutScheduleWhereUniqueInput[]
  }

  export type WorkoutProgramUpdateOneRequiredWithoutDaysNestedInput = {
    create?: XOR<WorkoutProgramCreateWithoutDaysInput, WorkoutProgramUncheckedCreateWithoutDaysInput>
    connectOrCreate?: WorkoutProgramCreateOrConnectWithoutDaysInput
    upsert?: WorkoutProgramUpsertWithoutDaysInput
    connect?: WorkoutProgramWhereUniqueInput
    update?: XOR<XOR<WorkoutProgramUpdateToOneWithWhereWithoutDaysInput, WorkoutProgramUpdateWithoutDaysInput>, WorkoutProgramUncheckedUpdateWithoutDaysInput>
  }

  export type WorkoutProgramExerciseUpdateManyWithoutProgramDayNestedInput = {
    create?: XOR<WorkoutProgramExerciseCreateWithoutProgramDayInput, WorkoutProgramExerciseUncheckedCreateWithoutProgramDayInput> | WorkoutProgramExerciseCreateWithoutProgramDayInput[] | WorkoutProgramExerciseUncheckedCreateWithoutProgramDayInput[]
    connectOrCreate?: WorkoutProgramExerciseCreateOrConnectWithoutProgramDayInput | WorkoutProgramExerciseCreateOrConnectWithoutProgramDayInput[]
    upsert?: WorkoutProgramExerciseUpsertWithWhereUniqueWithoutProgramDayInput | WorkoutProgramExerciseUpsertWithWhereUniqueWithoutProgramDayInput[]
    createMany?: WorkoutProgramExerciseCreateManyProgramDayInputEnvelope
    set?: WorkoutProgramExerciseWhereUniqueInput | WorkoutProgramExerciseWhereUniqueInput[]
    disconnect?: WorkoutProgramExerciseWhereUniqueInput | WorkoutProgramExerciseWhereUniqueInput[]
    delete?: WorkoutProgramExerciseWhereUniqueInput | WorkoutProgramExerciseWhereUniqueInput[]
    connect?: WorkoutProgramExerciseWhereUniqueInput | WorkoutProgramExerciseWhereUniqueInput[]
    update?: WorkoutProgramExerciseUpdateWithWhereUniqueWithoutProgramDayInput | WorkoutProgramExerciseUpdateWithWhereUniqueWithoutProgramDayInput[]
    updateMany?: WorkoutProgramExerciseUpdateManyWithWhereWithoutProgramDayInput | WorkoutProgramExerciseUpdateManyWithWhereWithoutProgramDayInput[]
    deleteMany?: WorkoutProgramExerciseScalarWhereInput | WorkoutProgramExerciseScalarWhereInput[]
  }

  export type WorkoutScheduleUpdateManyWithoutProgramDayNestedInput = {
    create?: XOR<WorkoutScheduleCreateWithoutProgramDayInput, WorkoutScheduleUncheckedCreateWithoutProgramDayInput> | WorkoutScheduleCreateWithoutProgramDayInput[] | WorkoutScheduleUncheckedCreateWithoutProgramDayInput[]
    connectOrCreate?: WorkoutScheduleCreateOrConnectWithoutProgramDayInput | WorkoutScheduleCreateOrConnectWithoutProgramDayInput[]
    upsert?: WorkoutScheduleUpsertWithWhereUniqueWithoutProgramDayInput | WorkoutScheduleUpsertWithWhereUniqueWithoutProgramDayInput[]
    createMany?: WorkoutScheduleCreateManyProgramDayInputEnvelope
    set?: WorkoutScheduleWhereUniqueInput | WorkoutScheduleWhereUniqueInput[]
    disconnect?: WorkoutScheduleWhereUniqueInput | WorkoutScheduleWhereUniqueInput[]
    delete?: WorkoutScheduleWhereUniqueInput | WorkoutScheduleWhereUniqueInput[]
    connect?: WorkoutScheduleWhereUniqueInput | WorkoutScheduleWhereUniqueInput[]
    update?: WorkoutScheduleUpdateWithWhereUniqueWithoutProgramDayInput | WorkoutScheduleUpdateWithWhereUniqueWithoutProgramDayInput[]
    updateMany?: WorkoutScheduleUpdateManyWithWhereWithoutProgramDayInput | WorkoutScheduleUpdateManyWithWhereWithoutProgramDayInput[]
    deleteMany?: WorkoutScheduleScalarWhereInput | WorkoutScheduleScalarWhereInput[]
  }

  export type WorkoutProgramExerciseUncheckedUpdateManyWithoutProgramDayNestedInput = {
    create?: XOR<WorkoutProgramExerciseCreateWithoutProgramDayInput, WorkoutProgramExerciseUncheckedCreateWithoutProgramDayInput> | WorkoutProgramExerciseCreateWithoutProgramDayInput[] | WorkoutProgramExerciseUncheckedCreateWithoutProgramDayInput[]
    connectOrCreate?: WorkoutProgramExerciseCreateOrConnectWithoutProgramDayInput | WorkoutProgramExerciseCreateOrConnectWithoutProgramDayInput[]
    upsert?: WorkoutProgramExerciseUpsertWithWhereUniqueWithoutProgramDayInput | WorkoutProgramExerciseUpsertWithWhereUniqueWithoutProgramDayInput[]
    createMany?: WorkoutProgramExerciseCreateManyProgramDayInputEnvelope
    set?: WorkoutProgramExerciseWhereUniqueInput | WorkoutProgramExerciseWhereUniqueInput[]
    disconnect?: WorkoutProgramExerciseWhereUniqueInput | WorkoutProgramExerciseWhereUniqueInput[]
    delete?: WorkoutProgramExerciseWhereUniqueInput | WorkoutProgramExerciseWhereUniqueInput[]
    connect?: WorkoutProgramExerciseWhereUniqueInput | WorkoutProgramExerciseWhereUniqueInput[]
    update?: WorkoutProgramExerciseUpdateWithWhereUniqueWithoutProgramDayInput | WorkoutProgramExerciseUpdateWithWhereUniqueWithoutProgramDayInput[]
    updateMany?: WorkoutProgramExerciseUpdateManyWithWhereWithoutProgramDayInput | WorkoutProgramExerciseUpdateManyWithWhereWithoutProgramDayInput[]
    deleteMany?: WorkoutProgramExerciseScalarWhereInput | WorkoutProgramExerciseScalarWhereInput[]
  }

  export type WorkoutScheduleUncheckedUpdateManyWithoutProgramDayNestedInput = {
    create?: XOR<WorkoutScheduleCreateWithoutProgramDayInput, WorkoutScheduleUncheckedCreateWithoutProgramDayInput> | WorkoutScheduleCreateWithoutProgramDayInput[] | WorkoutScheduleUncheckedCreateWithoutProgramDayInput[]
    connectOrCreate?: WorkoutScheduleCreateOrConnectWithoutProgramDayInput | WorkoutScheduleCreateOrConnectWithoutProgramDayInput[]
    upsert?: WorkoutScheduleUpsertWithWhereUniqueWithoutProgramDayInput | WorkoutScheduleUpsertWithWhereUniqueWithoutProgramDayInput[]
    createMany?: WorkoutScheduleCreateManyProgramDayInputEnvelope
    set?: WorkoutScheduleWhereUniqueInput | WorkoutScheduleWhereUniqueInput[]
    disconnect?: WorkoutScheduleWhereUniqueInput | WorkoutScheduleWhereUniqueInput[]
    delete?: WorkoutScheduleWhereUniqueInput | WorkoutScheduleWhereUniqueInput[]
    connect?: WorkoutScheduleWhereUniqueInput | WorkoutScheduleWhereUniqueInput[]
    update?: WorkoutScheduleUpdateWithWhereUniqueWithoutProgramDayInput | WorkoutScheduleUpdateWithWhereUniqueWithoutProgramDayInput[]
    updateMany?: WorkoutScheduleUpdateManyWithWhereWithoutProgramDayInput | WorkoutScheduleUpdateManyWithWhereWithoutProgramDayInput[]
    deleteMany?: WorkoutScheduleScalarWhereInput | WorkoutScheduleScalarWhereInput[]
  }

  export type WorkoutProgramDayCreateNestedOneWithoutExercisesInput = {
    create?: XOR<WorkoutProgramDayCreateWithoutExercisesInput, WorkoutProgramDayUncheckedCreateWithoutExercisesInput>
    connectOrCreate?: WorkoutProgramDayCreateOrConnectWithoutExercisesInput
    connect?: WorkoutProgramDayWhereUniqueInput
  }

  export type ExerciseCreateNestedOneWithoutWorkoutProgramExercisesInput = {
    create?: XOR<ExerciseCreateWithoutWorkoutProgramExercisesInput, ExerciseUncheckedCreateWithoutWorkoutProgramExercisesInput>
    connectOrCreate?: ExerciseCreateOrConnectWithoutWorkoutProgramExercisesInput
    connect?: ExerciseWhereUniqueInput
  }

  export type WorkoutProgramDayUpdateOneRequiredWithoutExercisesNestedInput = {
    create?: XOR<WorkoutProgramDayCreateWithoutExercisesInput, WorkoutProgramDayUncheckedCreateWithoutExercisesInput>
    connectOrCreate?: WorkoutProgramDayCreateOrConnectWithoutExercisesInput
    upsert?: WorkoutProgramDayUpsertWithoutExercisesInput
    connect?: WorkoutProgramDayWhereUniqueInput
    update?: XOR<XOR<WorkoutProgramDayUpdateToOneWithWhereWithoutExercisesInput, WorkoutProgramDayUpdateWithoutExercisesInput>, WorkoutProgramDayUncheckedUpdateWithoutExercisesInput>
  }

  export type ExerciseUpdateOneRequiredWithoutWorkoutProgramExercisesNestedInput = {
    create?: XOR<ExerciseCreateWithoutWorkoutProgramExercisesInput, ExerciseUncheckedCreateWithoutWorkoutProgramExercisesInput>
    connectOrCreate?: ExerciseCreateOrConnectWithoutWorkoutProgramExercisesInput
    upsert?: ExerciseUpsertWithoutWorkoutProgramExercisesInput
    connect?: ExerciseWhereUniqueInput
    update?: XOR<XOR<ExerciseUpdateToOneWithWhereWithoutWorkoutProgramExercisesInput, ExerciseUpdateWithoutWorkoutProgramExercisesInput>, ExerciseUncheckedUpdateWithoutWorkoutProgramExercisesInput>
  }

  export type WorkoutProgramDayCreateNestedOneWithoutSchedulesInput = {
    create?: XOR<WorkoutProgramDayCreateWithoutSchedulesInput, WorkoutProgramDayUncheckedCreateWithoutSchedulesInput>
    connectOrCreate?: WorkoutProgramDayCreateOrConnectWithoutSchedulesInput
    connect?: WorkoutProgramDayWhereUniqueInput
  }

  export type WorkoutCreateNestedOneWithoutSchedulesInput = {
    create?: XOR<WorkoutCreateWithoutSchedulesInput, WorkoutUncheckedCreateWithoutSchedulesInput>
    connectOrCreate?: WorkoutCreateOrConnectWithoutSchedulesInput
    connect?: WorkoutWhereUniqueInput
  }

  export type WorkoutProgramDayUpdateOneWithoutSchedulesNestedInput = {
    create?: XOR<WorkoutProgramDayCreateWithoutSchedulesInput, WorkoutProgramDayUncheckedCreateWithoutSchedulesInput>
    connectOrCreate?: WorkoutProgramDayCreateOrConnectWithoutSchedulesInput
    upsert?: WorkoutProgramDayUpsertWithoutSchedulesInput
    disconnect?: WorkoutProgramDayWhereInput | boolean
    delete?: WorkoutProgramDayWhereInput | boolean
    connect?: WorkoutProgramDayWhereUniqueInput
    update?: XOR<XOR<WorkoutProgramDayUpdateToOneWithWhereWithoutSchedulesInput, WorkoutProgramDayUpdateWithoutSchedulesInput>, WorkoutProgramDayUncheckedUpdateWithoutSchedulesInput>
  }

  export type WorkoutUpdateOneWithoutSchedulesNestedInput = {
    create?: XOR<WorkoutCreateWithoutSchedulesInput, WorkoutUncheckedCreateWithoutSchedulesInput>
    connectOrCreate?: WorkoutCreateOrConnectWithoutSchedulesInput
    upsert?: WorkoutUpsertWithoutSchedulesInput
    disconnect?: WorkoutWhereInput | boolean
    delete?: WorkoutWhereInput | boolean
    connect?: WorkoutWhereUniqueInput
    update?: XOR<XOR<WorkoutUpdateToOneWithWhereWithoutSchedulesInput, WorkoutUpdateWithoutSchedulesInput>, WorkoutUncheckedUpdateWithoutSchedulesInput>
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

  export type NestedEnumExerciseTypeFilter<$PrismaModel = never> = {
    equals?: $Enums.ExerciseType | EnumExerciseTypeFieldRefInput<$PrismaModel>
    in?: $Enums.ExerciseType[] | ListEnumExerciseTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.ExerciseType[] | ListEnumExerciseTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumExerciseTypeFilter<$PrismaModel> | $Enums.ExerciseType
  }

  export type NestedEnumEquipmentTypeFilter<$PrismaModel = never> = {
    equals?: $Enums.EquipmentType | EnumEquipmentTypeFieldRefInput<$PrismaModel>
    in?: $Enums.EquipmentType[] | ListEnumEquipmentTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.EquipmentType[] | ListEnumEquipmentTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumEquipmentTypeFilter<$PrismaModel> | $Enums.EquipmentType
  }

  export type NestedEnumBodyPartFilter<$PrismaModel = never> = {
    equals?: $Enums.BodyPart | EnumBodyPartFieldRefInput<$PrismaModel>
    in?: $Enums.BodyPart[] | ListEnumBodyPartFieldRefInput<$PrismaModel>
    notIn?: $Enums.BodyPart[] | ListEnumBodyPartFieldRefInput<$PrismaModel>
    not?: NestedEnumBodyPartFilter<$PrismaModel> | $Enums.BodyPart
  }

  export type NestedEnumMovementTypeFilter<$PrismaModel = never> = {
    equals?: $Enums.MovementType | EnumMovementTypeFieldRefInput<$PrismaModel>
    in?: $Enums.MovementType[] | ListEnumMovementTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.MovementType[] | ListEnumMovementTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumMovementTypeFilter<$PrismaModel> | $Enums.MovementType
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

  export type NestedEnumExerciseTypeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.ExerciseType | EnumExerciseTypeFieldRefInput<$PrismaModel>
    in?: $Enums.ExerciseType[] | ListEnumExerciseTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.ExerciseType[] | ListEnumExerciseTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumExerciseTypeWithAggregatesFilter<$PrismaModel> | $Enums.ExerciseType
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumExerciseTypeFilter<$PrismaModel>
    _max?: NestedEnumExerciseTypeFilter<$PrismaModel>
  }

  export type NestedEnumEquipmentTypeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.EquipmentType | EnumEquipmentTypeFieldRefInput<$PrismaModel>
    in?: $Enums.EquipmentType[] | ListEnumEquipmentTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.EquipmentType[] | ListEnumEquipmentTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumEquipmentTypeWithAggregatesFilter<$PrismaModel> | $Enums.EquipmentType
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumEquipmentTypeFilter<$PrismaModel>
    _max?: NestedEnumEquipmentTypeFilter<$PrismaModel>
  }

  export type NestedEnumBodyPartWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.BodyPart | EnumBodyPartFieldRefInput<$PrismaModel>
    in?: $Enums.BodyPart[] | ListEnumBodyPartFieldRefInput<$PrismaModel>
    notIn?: $Enums.BodyPart[] | ListEnumBodyPartFieldRefInput<$PrismaModel>
    not?: NestedEnumBodyPartWithAggregatesFilter<$PrismaModel> | $Enums.BodyPart
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumBodyPartFilter<$PrismaModel>
    _max?: NestedEnumBodyPartFilter<$PrismaModel>
  }

  export type NestedEnumMovementTypeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.MovementType | EnumMovementTypeFieldRefInput<$PrismaModel>
    in?: $Enums.MovementType[] | ListEnumMovementTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.MovementType[] | ListEnumMovementTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumMovementTypeWithAggregatesFilter<$PrismaModel> | $Enums.MovementType
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumMovementTypeFilter<$PrismaModel>
    _max?: NestedEnumMovementTypeFilter<$PrismaModel>
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

  export type NestedBoolFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolFilter<$PrismaModel> | boolean
  }

  export type NestedBoolWithAggregatesFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolWithAggregatesFilter<$PrismaModel> | boolean
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedBoolFilter<$PrismaModel>
    _max?: NestedBoolFilter<$PrismaModel>
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

  export type WorkoutExerciseCreateWithoutExerciseInput = {
    id?: string
    sets: number
    reps?: number | null
    duration?: number | null
    weight?: number | null
    notes?: string | null
    order?: number
    createdAt?: Date | string
    workout: WorkoutCreateNestedOneWithoutExercisesInput
    workoutSets?: WorkoutSetCreateNestedManyWithoutWorkoutExerciseInput
  }

  export type WorkoutExerciseUncheckedCreateWithoutExerciseInput = {
    id?: string
    workoutId: string
    sets: number
    reps?: number | null
    duration?: number | null
    weight?: number | null
    notes?: string | null
    order?: number
    createdAt?: Date | string
    workoutSets?: WorkoutSetUncheckedCreateNestedManyWithoutWorkoutExerciseInput
  }

  export type WorkoutExerciseCreateOrConnectWithoutExerciseInput = {
    where: WorkoutExerciseWhereUniqueInput
    create: XOR<WorkoutExerciseCreateWithoutExerciseInput, WorkoutExerciseUncheckedCreateWithoutExerciseInput>
  }

  export type WorkoutExerciseCreateManyExerciseInputEnvelope = {
    data: WorkoutExerciseCreateManyExerciseInput | WorkoutExerciseCreateManyExerciseInput[]
    skipDuplicates?: boolean
  }

  export type WorkoutProgramExerciseCreateWithoutExerciseInput = {
    id?: string
    order?: number
    sets?: number | null
    reps?: number | null
    weight?: number | null
    duration?: number | null
    restSeconds?: number | null
    notes?: string | null
    createdAt?: Date | string
    programDay: WorkoutProgramDayCreateNestedOneWithoutExercisesInput
  }

  export type WorkoutProgramExerciseUncheckedCreateWithoutExerciseInput = {
    id?: string
    programDayId: string
    order?: number
    sets?: number | null
    reps?: number | null
    weight?: number | null
    duration?: number | null
    restSeconds?: number | null
    notes?: string | null
    createdAt?: Date | string
  }

  export type WorkoutProgramExerciseCreateOrConnectWithoutExerciseInput = {
    where: WorkoutProgramExerciseWhereUniqueInput
    create: XOR<WorkoutProgramExerciseCreateWithoutExerciseInput, WorkoutProgramExerciseUncheckedCreateWithoutExerciseInput>
  }

  export type WorkoutProgramExerciseCreateManyExerciseInputEnvelope = {
    data: WorkoutProgramExerciseCreateManyExerciseInput | WorkoutProgramExerciseCreateManyExerciseInput[]
    skipDuplicates?: boolean
  }

  export type WorkoutExerciseUpsertWithWhereUniqueWithoutExerciseInput = {
    where: WorkoutExerciseWhereUniqueInput
    update: XOR<WorkoutExerciseUpdateWithoutExerciseInput, WorkoutExerciseUncheckedUpdateWithoutExerciseInput>
    create: XOR<WorkoutExerciseCreateWithoutExerciseInput, WorkoutExerciseUncheckedCreateWithoutExerciseInput>
  }

  export type WorkoutExerciseUpdateWithWhereUniqueWithoutExerciseInput = {
    where: WorkoutExerciseWhereUniqueInput
    data: XOR<WorkoutExerciseUpdateWithoutExerciseInput, WorkoutExerciseUncheckedUpdateWithoutExerciseInput>
  }

  export type WorkoutExerciseUpdateManyWithWhereWithoutExerciseInput = {
    where: WorkoutExerciseScalarWhereInput
    data: XOR<WorkoutExerciseUpdateManyMutationInput, WorkoutExerciseUncheckedUpdateManyWithoutExerciseInput>
  }

  export type WorkoutExerciseScalarWhereInput = {
    AND?: WorkoutExerciseScalarWhereInput | WorkoutExerciseScalarWhereInput[]
    OR?: WorkoutExerciseScalarWhereInput[]
    NOT?: WorkoutExerciseScalarWhereInput | WorkoutExerciseScalarWhereInput[]
    id?: StringFilter<"WorkoutExercise"> | string
    workoutId?: StringFilter<"WorkoutExercise"> | string
    exerciseId?: StringFilter<"WorkoutExercise"> | string
    sets?: IntFilter<"WorkoutExercise"> | number
    reps?: IntNullableFilter<"WorkoutExercise"> | number | null
    duration?: IntNullableFilter<"WorkoutExercise"> | number | null
    weight?: FloatNullableFilter<"WorkoutExercise"> | number | null
    notes?: StringNullableFilter<"WorkoutExercise"> | string | null
    order?: IntFilter<"WorkoutExercise"> | number
    createdAt?: DateTimeFilter<"WorkoutExercise"> | Date | string
  }

  export type WorkoutProgramExerciseUpsertWithWhereUniqueWithoutExerciseInput = {
    where: WorkoutProgramExerciseWhereUniqueInput
    update: XOR<WorkoutProgramExerciseUpdateWithoutExerciseInput, WorkoutProgramExerciseUncheckedUpdateWithoutExerciseInput>
    create: XOR<WorkoutProgramExerciseCreateWithoutExerciseInput, WorkoutProgramExerciseUncheckedCreateWithoutExerciseInput>
  }

  export type WorkoutProgramExerciseUpdateWithWhereUniqueWithoutExerciseInput = {
    where: WorkoutProgramExerciseWhereUniqueInput
    data: XOR<WorkoutProgramExerciseUpdateWithoutExerciseInput, WorkoutProgramExerciseUncheckedUpdateWithoutExerciseInput>
  }

  export type WorkoutProgramExerciseUpdateManyWithWhereWithoutExerciseInput = {
    where: WorkoutProgramExerciseScalarWhereInput
    data: XOR<WorkoutProgramExerciseUpdateManyMutationInput, WorkoutProgramExerciseUncheckedUpdateManyWithoutExerciseInput>
  }

  export type WorkoutProgramExerciseScalarWhereInput = {
    AND?: WorkoutProgramExerciseScalarWhereInput | WorkoutProgramExerciseScalarWhereInput[]
    OR?: WorkoutProgramExerciseScalarWhereInput[]
    NOT?: WorkoutProgramExerciseScalarWhereInput | WorkoutProgramExerciseScalarWhereInput[]
    id?: StringFilter<"WorkoutProgramExercise"> | string
    programDayId?: StringFilter<"WorkoutProgramExercise"> | string
    exerciseId?: StringFilter<"WorkoutProgramExercise"> | string
    order?: IntFilter<"WorkoutProgramExercise"> | number
    sets?: IntNullableFilter<"WorkoutProgramExercise"> | number | null
    reps?: IntNullableFilter<"WorkoutProgramExercise"> | number | null
    weight?: FloatNullableFilter<"WorkoutProgramExercise"> | number | null
    duration?: IntNullableFilter<"WorkoutProgramExercise"> | number | null
    restSeconds?: IntNullableFilter<"WorkoutProgramExercise"> | number | null
    notes?: StringNullableFilter<"WorkoutProgramExercise"> | string | null
    createdAt?: DateTimeFilter<"WorkoutProgramExercise"> | Date | string
  }

  export type WorkoutExerciseCreateWithoutWorkoutInput = {
    id?: string
    sets: number
    reps?: number | null
    duration?: number | null
    weight?: number | null
    notes?: string | null
    order?: number
    createdAt?: Date | string
    exercise: ExerciseCreateNestedOneWithoutWorkoutExercisesInput
    workoutSets?: WorkoutSetCreateNestedManyWithoutWorkoutExerciseInput
  }

  export type WorkoutExerciseUncheckedCreateWithoutWorkoutInput = {
    id?: string
    exerciseId: string
    sets: number
    reps?: number | null
    duration?: number | null
    weight?: number | null
    notes?: string | null
    order?: number
    createdAt?: Date | string
    workoutSets?: WorkoutSetUncheckedCreateNestedManyWithoutWorkoutExerciseInput
  }

  export type WorkoutExerciseCreateOrConnectWithoutWorkoutInput = {
    where: WorkoutExerciseWhereUniqueInput
    create: XOR<WorkoutExerciseCreateWithoutWorkoutInput, WorkoutExerciseUncheckedCreateWithoutWorkoutInput>
  }

  export type WorkoutExerciseCreateManyWorkoutInputEnvelope = {
    data: WorkoutExerciseCreateManyWorkoutInput | WorkoutExerciseCreateManyWorkoutInput[]
    skipDuplicates?: boolean
  }

  export type WorkoutScheduleCreateWithoutWorkoutInput = {
    id?: string
    userId: string
    date: Date | string
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    programDay?: WorkoutProgramDayCreateNestedOneWithoutSchedulesInput
  }

  export type WorkoutScheduleUncheckedCreateWithoutWorkoutInput = {
    id?: string
    userId: string
    date: Date | string
    programDayId?: string | null
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type WorkoutScheduleCreateOrConnectWithoutWorkoutInput = {
    where: WorkoutScheduleWhereUniqueInput
    create: XOR<WorkoutScheduleCreateWithoutWorkoutInput, WorkoutScheduleUncheckedCreateWithoutWorkoutInput>
  }

  export type WorkoutScheduleCreateManyWorkoutInputEnvelope = {
    data: WorkoutScheduleCreateManyWorkoutInput | WorkoutScheduleCreateManyWorkoutInput[]
    skipDuplicates?: boolean
  }

  export type WorkoutExerciseUpsertWithWhereUniqueWithoutWorkoutInput = {
    where: WorkoutExerciseWhereUniqueInput
    update: XOR<WorkoutExerciseUpdateWithoutWorkoutInput, WorkoutExerciseUncheckedUpdateWithoutWorkoutInput>
    create: XOR<WorkoutExerciseCreateWithoutWorkoutInput, WorkoutExerciseUncheckedCreateWithoutWorkoutInput>
  }

  export type WorkoutExerciseUpdateWithWhereUniqueWithoutWorkoutInput = {
    where: WorkoutExerciseWhereUniqueInput
    data: XOR<WorkoutExerciseUpdateWithoutWorkoutInput, WorkoutExerciseUncheckedUpdateWithoutWorkoutInput>
  }

  export type WorkoutExerciseUpdateManyWithWhereWithoutWorkoutInput = {
    where: WorkoutExerciseScalarWhereInput
    data: XOR<WorkoutExerciseUpdateManyMutationInput, WorkoutExerciseUncheckedUpdateManyWithoutWorkoutInput>
  }

  export type WorkoutScheduleUpsertWithWhereUniqueWithoutWorkoutInput = {
    where: WorkoutScheduleWhereUniqueInput
    update: XOR<WorkoutScheduleUpdateWithoutWorkoutInput, WorkoutScheduleUncheckedUpdateWithoutWorkoutInput>
    create: XOR<WorkoutScheduleCreateWithoutWorkoutInput, WorkoutScheduleUncheckedCreateWithoutWorkoutInput>
  }

  export type WorkoutScheduleUpdateWithWhereUniqueWithoutWorkoutInput = {
    where: WorkoutScheduleWhereUniqueInput
    data: XOR<WorkoutScheduleUpdateWithoutWorkoutInput, WorkoutScheduleUncheckedUpdateWithoutWorkoutInput>
  }

  export type WorkoutScheduleUpdateManyWithWhereWithoutWorkoutInput = {
    where: WorkoutScheduleScalarWhereInput
    data: XOR<WorkoutScheduleUpdateManyMutationInput, WorkoutScheduleUncheckedUpdateManyWithoutWorkoutInput>
  }

  export type WorkoutScheduleScalarWhereInput = {
    AND?: WorkoutScheduleScalarWhereInput | WorkoutScheduleScalarWhereInput[]
    OR?: WorkoutScheduleScalarWhereInput[]
    NOT?: WorkoutScheduleScalarWhereInput | WorkoutScheduleScalarWhereInput[]
    id?: StringFilter<"WorkoutSchedule"> | string
    userId?: StringFilter<"WorkoutSchedule"> | string
    date?: DateTimeFilter<"WorkoutSchedule"> | Date | string
    programDayId?: StringNullableFilter<"WorkoutSchedule"> | string | null
    workoutId?: StringNullableFilter<"WorkoutSchedule"> | string | null
    notes?: StringNullableFilter<"WorkoutSchedule"> | string | null
    createdAt?: DateTimeFilter<"WorkoutSchedule"> | Date | string
    updatedAt?: DateTimeFilter<"WorkoutSchedule"> | Date | string
  }

  export type WorkoutCreateWithoutExercisesInput = {
    id?: string
    userId: string
    name: string
    description?: string | null
    date?: Date | string
    duration?: number | null
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    schedules?: WorkoutScheduleCreateNestedManyWithoutWorkoutInput
  }

  export type WorkoutUncheckedCreateWithoutExercisesInput = {
    id?: string
    userId: string
    name: string
    description?: string | null
    date?: Date | string
    duration?: number | null
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    schedules?: WorkoutScheduleUncheckedCreateNestedManyWithoutWorkoutInput
  }

  export type WorkoutCreateOrConnectWithoutExercisesInput = {
    where: WorkoutWhereUniqueInput
    create: XOR<WorkoutCreateWithoutExercisesInput, WorkoutUncheckedCreateWithoutExercisesInput>
  }

  export type ExerciseCreateWithoutWorkoutExercisesInput = {
    id?: string
    exerciseName: string
    typeOfActivity: $Enums.ExerciseType
    typeOfEquipment: $Enums.EquipmentType
    bodyPart: $Enums.BodyPart
    type: $Enums.MovementType
    muscleGroupsActivated?: ExerciseCreatemuscleGroupsActivatedInput | string[]
    instructions: string
    videoUrl?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    workoutProgramExercises?: WorkoutProgramExerciseCreateNestedManyWithoutExerciseInput
  }

  export type ExerciseUncheckedCreateWithoutWorkoutExercisesInput = {
    id?: string
    exerciseName: string
    typeOfActivity: $Enums.ExerciseType
    typeOfEquipment: $Enums.EquipmentType
    bodyPart: $Enums.BodyPart
    type: $Enums.MovementType
    muscleGroupsActivated?: ExerciseCreatemuscleGroupsActivatedInput | string[]
    instructions: string
    videoUrl?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    workoutProgramExercises?: WorkoutProgramExerciseUncheckedCreateNestedManyWithoutExerciseInput
  }

  export type ExerciseCreateOrConnectWithoutWorkoutExercisesInput = {
    where: ExerciseWhereUniqueInput
    create: XOR<ExerciseCreateWithoutWorkoutExercisesInput, ExerciseUncheckedCreateWithoutWorkoutExercisesInput>
  }

  export type WorkoutSetCreateWithoutWorkoutExerciseInput = {
    id?: string
    setNumber: number
    reps?: number | null
    weight?: number | null
    rpe?: number | null
    completed?: boolean
    createdAt?: Date | string
  }

  export type WorkoutSetUncheckedCreateWithoutWorkoutExerciseInput = {
    id?: string
    setNumber: number
    reps?: number | null
    weight?: number | null
    rpe?: number | null
    completed?: boolean
    createdAt?: Date | string
  }

  export type WorkoutSetCreateOrConnectWithoutWorkoutExerciseInput = {
    where: WorkoutSetWhereUniqueInput
    create: XOR<WorkoutSetCreateWithoutWorkoutExerciseInput, WorkoutSetUncheckedCreateWithoutWorkoutExerciseInput>
  }

  export type WorkoutSetCreateManyWorkoutExerciseInputEnvelope = {
    data: WorkoutSetCreateManyWorkoutExerciseInput | WorkoutSetCreateManyWorkoutExerciseInput[]
    skipDuplicates?: boolean
  }

  export type WorkoutUpsertWithoutExercisesInput = {
    update: XOR<WorkoutUpdateWithoutExercisesInput, WorkoutUncheckedUpdateWithoutExercisesInput>
    create: XOR<WorkoutCreateWithoutExercisesInput, WorkoutUncheckedCreateWithoutExercisesInput>
    where?: WorkoutWhereInput
  }

  export type WorkoutUpdateToOneWithWhereWithoutExercisesInput = {
    where?: WorkoutWhereInput
    data: XOR<WorkoutUpdateWithoutExercisesInput, WorkoutUncheckedUpdateWithoutExercisesInput>
  }

  export type WorkoutUpdateWithoutExercisesInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    schedules?: WorkoutScheduleUpdateManyWithoutWorkoutNestedInput
  }

  export type WorkoutUncheckedUpdateWithoutExercisesInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    schedules?: WorkoutScheduleUncheckedUpdateManyWithoutWorkoutNestedInput
  }

  export type ExerciseUpsertWithoutWorkoutExercisesInput = {
    update: XOR<ExerciseUpdateWithoutWorkoutExercisesInput, ExerciseUncheckedUpdateWithoutWorkoutExercisesInput>
    create: XOR<ExerciseCreateWithoutWorkoutExercisesInput, ExerciseUncheckedCreateWithoutWorkoutExercisesInput>
    where?: ExerciseWhereInput
  }

  export type ExerciseUpdateToOneWithWhereWithoutWorkoutExercisesInput = {
    where?: ExerciseWhereInput
    data: XOR<ExerciseUpdateWithoutWorkoutExercisesInput, ExerciseUncheckedUpdateWithoutWorkoutExercisesInput>
  }

  export type ExerciseUpdateWithoutWorkoutExercisesInput = {
    id?: StringFieldUpdateOperationsInput | string
    exerciseName?: StringFieldUpdateOperationsInput | string
    typeOfActivity?: EnumExerciseTypeFieldUpdateOperationsInput | $Enums.ExerciseType
    typeOfEquipment?: EnumEquipmentTypeFieldUpdateOperationsInput | $Enums.EquipmentType
    bodyPart?: EnumBodyPartFieldUpdateOperationsInput | $Enums.BodyPart
    type?: EnumMovementTypeFieldUpdateOperationsInput | $Enums.MovementType
    muscleGroupsActivated?: ExerciseUpdatemuscleGroupsActivatedInput | string[]
    instructions?: StringFieldUpdateOperationsInput | string
    videoUrl?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    workoutProgramExercises?: WorkoutProgramExerciseUpdateManyWithoutExerciseNestedInput
  }

  export type ExerciseUncheckedUpdateWithoutWorkoutExercisesInput = {
    id?: StringFieldUpdateOperationsInput | string
    exerciseName?: StringFieldUpdateOperationsInput | string
    typeOfActivity?: EnumExerciseTypeFieldUpdateOperationsInput | $Enums.ExerciseType
    typeOfEquipment?: EnumEquipmentTypeFieldUpdateOperationsInput | $Enums.EquipmentType
    bodyPart?: EnumBodyPartFieldUpdateOperationsInput | $Enums.BodyPart
    type?: EnumMovementTypeFieldUpdateOperationsInput | $Enums.MovementType
    muscleGroupsActivated?: ExerciseUpdatemuscleGroupsActivatedInput | string[]
    instructions?: StringFieldUpdateOperationsInput | string
    videoUrl?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    workoutProgramExercises?: WorkoutProgramExerciseUncheckedUpdateManyWithoutExerciseNestedInput
  }

  export type WorkoutSetUpsertWithWhereUniqueWithoutWorkoutExerciseInput = {
    where: WorkoutSetWhereUniqueInput
    update: XOR<WorkoutSetUpdateWithoutWorkoutExerciseInput, WorkoutSetUncheckedUpdateWithoutWorkoutExerciseInput>
    create: XOR<WorkoutSetCreateWithoutWorkoutExerciseInput, WorkoutSetUncheckedCreateWithoutWorkoutExerciseInput>
  }

  export type WorkoutSetUpdateWithWhereUniqueWithoutWorkoutExerciseInput = {
    where: WorkoutSetWhereUniqueInput
    data: XOR<WorkoutSetUpdateWithoutWorkoutExerciseInput, WorkoutSetUncheckedUpdateWithoutWorkoutExerciseInput>
  }

  export type WorkoutSetUpdateManyWithWhereWithoutWorkoutExerciseInput = {
    where: WorkoutSetScalarWhereInput
    data: XOR<WorkoutSetUpdateManyMutationInput, WorkoutSetUncheckedUpdateManyWithoutWorkoutExerciseInput>
  }

  export type WorkoutSetScalarWhereInput = {
    AND?: WorkoutSetScalarWhereInput | WorkoutSetScalarWhereInput[]
    OR?: WorkoutSetScalarWhereInput[]
    NOT?: WorkoutSetScalarWhereInput | WorkoutSetScalarWhereInput[]
    id?: StringFilter<"WorkoutSet"> | string
    workoutExerciseId?: StringFilter<"WorkoutSet"> | string
    setNumber?: IntFilter<"WorkoutSet"> | number
    reps?: IntNullableFilter<"WorkoutSet"> | number | null
    weight?: FloatNullableFilter<"WorkoutSet"> | number | null
    rpe?: FloatNullableFilter<"WorkoutSet"> | number | null
    completed?: BoolFilter<"WorkoutSet"> | boolean
    createdAt?: DateTimeFilter<"WorkoutSet"> | Date | string
  }

  export type WorkoutExerciseCreateWithoutWorkoutSetsInput = {
    id?: string
    sets: number
    reps?: number | null
    duration?: number | null
    weight?: number | null
    notes?: string | null
    order?: number
    createdAt?: Date | string
    workout: WorkoutCreateNestedOneWithoutExercisesInput
    exercise: ExerciseCreateNestedOneWithoutWorkoutExercisesInput
  }

  export type WorkoutExerciseUncheckedCreateWithoutWorkoutSetsInput = {
    id?: string
    workoutId: string
    exerciseId: string
    sets: number
    reps?: number | null
    duration?: number | null
    weight?: number | null
    notes?: string | null
    order?: number
    createdAt?: Date | string
  }

  export type WorkoutExerciseCreateOrConnectWithoutWorkoutSetsInput = {
    where: WorkoutExerciseWhereUniqueInput
    create: XOR<WorkoutExerciseCreateWithoutWorkoutSetsInput, WorkoutExerciseUncheckedCreateWithoutWorkoutSetsInput>
  }

  export type WorkoutExerciseUpsertWithoutWorkoutSetsInput = {
    update: XOR<WorkoutExerciseUpdateWithoutWorkoutSetsInput, WorkoutExerciseUncheckedUpdateWithoutWorkoutSetsInput>
    create: XOR<WorkoutExerciseCreateWithoutWorkoutSetsInput, WorkoutExerciseUncheckedCreateWithoutWorkoutSetsInput>
    where?: WorkoutExerciseWhereInput
  }

  export type WorkoutExerciseUpdateToOneWithWhereWithoutWorkoutSetsInput = {
    where?: WorkoutExerciseWhereInput
    data: XOR<WorkoutExerciseUpdateWithoutWorkoutSetsInput, WorkoutExerciseUncheckedUpdateWithoutWorkoutSetsInput>
  }

  export type WorkoutExerciseUpdateWithoutWorkoutSetsInput = {
    id?: StringFieldUpdateOperationsInput | string
    sets?: IntFieldUpdateOperationsInput | number
    reps?: NullableIntFieldUpdateOperationsInput | number | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    weight?: NullableFloatFieldUpdateOperationsInput | number | null
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    order?: IntFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    workout?: WorkoutUpdateOneRequiredWithoutExercisesNestedInput
    exercise?: ExerciseUpdateOneRequiredWithoutWorkoutExercisesNestedInput
  }

  export type WorkoutExerciseUncheckedUpdateWithoutWorkoutSetsInput = {
    id?: StringFieldUpdateOperationsInput | string
    workoutId?: StringFieldUpdateOperationsInput | string
    exerciseId?: StringFieldUpdateOperationsInput | string
    sets?: IntFieldUpdateOperationsInput | number
    reps?: NullableIntFieldUpdateOperationsInput | number | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    weight?: NullableFloatFieldUpdateOperationsInput | number | null
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    order?: IntFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type WorkoutProgramDayCreateWithoutProgramInput = {
    id?: string
    dayNumber: number
    title: string
    description?: string | null
    duration?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
    exercises?: WorkoutProgramExerciseCreateNestedManyWithoutProgramDayInput
    schedules?: WorkoutScheduleCreateNestedManyWithoutProgramDayInput
  }

  export type WorkoutProgramDayUncheckedCreateWithoutProgramInput = {
    id?: string
    dayNumber: number
    title: string
    description?: string | null
    duration?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
    exercises?: WorkoutProgramExerciseUncheckedCreateNestedManyWithoutProgramDayInput
    schedules?: WorkoutScheduleUncheckedCreateNestedManyWithoutProgramDayInput
  }

  export type WorkoutProgramDayCreateOrConnectWithoutProgramInput = {
    where: WorkoutProgramDayWhereUniqueInput
    create: XOR<WorkoutProgramDayCreateWithoutProgramInput, WorkoutProgramDayUncheckedCreateWithoutProgramInput>
  }

  export type WorkoutProgramDayCreateManyProgramInputEnvelope = {
    data: WorkoutProgramDayCreateManyProgramInput | WorkoutProgramDayCreateManyProgramInput[]
    skipDuplicates?: boolean
  }

  export type WorkoutProgramDayUpsertWithWhereUniqueWithoutProgramInput = {
    where: WorkoutProgramDayWhereUniqueInput
    update: XOR<WorkoutProgramDayUpdateWithoutProgramInput, WorkoutProgramDayUncheckedUpdateWithoutProgramInput>
    create: XOR<WorkoutProgramDayCreateWithoutProgramInput, WorkoutProgramDayUncheckedCreateWithoutProgramInput>
  }

  export type WorkoutProgramDayUpdateWithWhereUniqueWithoutProgramInput = {
    where: WorkoutProgramDayWhereUniqueInput
    data: XOR<WorkoutProgramDayUpdateWithoutProgramInput, WorkoutProgramDayUncheckedUpdateWithoutProgramInput>
  }

  export type WorkoutProgramDayUpdateManyWithWhereWithoutProgramInput = {
    where: WorkoutProgramDayScalarWhereInput
    data: XOR<WorkoutProgramDayUpdateManyMutationInput, WorkoutProgramDayUncheckedUpdateManyWithoutProgramInput>
  }

  export type WorkoutProgramDayScalarWhereInput = {
    AND?: WorkoutProgramDayScalarWhereInput | WorkoutProgramDayScalarWhereInput[]
    OR?: WorkoutProgramDayScalarWhereInput[]
    NOT?: WorkoutProgramDayScalarWhereInput | WorkoutProgramDayScalarWhereInput[]
    id?: StringFilter<"WorkoutProgramDay"> | string
    programId?: StringFilter<"WorkoutProgramDay"> | string
    dayNumber?: IntFilter<"WorkoutProgramDay"> | number
    title?: StringFilter<"WorkoutProgramDay"> | string
    description?: StringNullableFilter<"WorkoutProgramDay"> | string | null
    duration?: IntNullableFilter<"WorkoutProgramDay"> | number | null
    createdAt?: DateTimeFilter<"WorkoutProgramDay"> | Date | string
    updatedAt?: DateTimeFilter<"WorkoutProgramDay"> | Date | string
  }

  export type WorkoutProgramCreateWithoutDaysInput = {
    id?: string
    userId: string
    name: string
    description?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type WorkoutProgramUncheckedCreateWithoutDaysInput = {
    id?: string
    userId: string
    name: string
    description?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type WorkoutProgramCreateOrConnectWithoutDaysInput = {
    where: WorkoutProgramWhereUniqueInput
    create: XOR<WorkoutProgramCreateWithoutDaysInput, WorkoutProgramUncheckedCreateWithoutDaysInput>
  }

  export type WorkoutProgramExerciseCreateWithoutProgramDayInput = {
    id?: string
    order?: number
    sets?: number | null
    reps?: number | null
    weight?: number | null
    duration?: number | null
    restSeconds?: number | null
    notes?: string | null
    createdAt?: Date | string
    exercise: ExerciseCreateNestedOneWithoutWorkoutProgramExercisesInput
  }

  export type WorkoutProgramExerciseUncheckedCreateWithoutProgramDayInput = {
    id?: string
    exerciseId: string
    order?: number
    sets?: number | null
    reps?: number | null
    weight?: number | null
    duration?: number | null
    restSeconds?: number | null
    notes?: string | null
    createdAt?: Date | string
  }

  export type WorkoutProgramExerciseCreateOrConnectWithoutProgramDayInput = {
    where: WorkoutProgramExerciseWhereUniqueInput
    create: XOR<WorkoutProgramExerciseCreateWithoutProgramDayInput, WorkoutProgramExerciseUncheckedCreateWithoutProgramDayInput>
  }

  export type WorkoutProgramExerciseCreateManyProgramDayInputEnvelope = {
    data: WorkoutProgramExerciseCreateManyProgramDayInput | WorkoutProgramExerciseCreateManyProgramDayInput[]
    skipDuplicates?: boolean
  }

  export type WorkoutScheduleCreateWithoutProgramDayInput = {
    id?: string
    userId: string
    date: Date | string
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    workout?: WorkoutCreateNestedOneWithoutSchedulesInput
  }

  export type WorkoutScheduleUncheckedCreateWithoutProgramDayInput = {
    id?: string
    userId: string
    date: Date | string
    workoutId?: string | null
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type WorkoutScheduleCreateOrConnectWithoutProgramDayInput = {
    where: WorkoutScheduleWhereUniqueInput
    create: XOR<WorkoutScheduleCreateWithoutProgramDayInput, WorkoutScheduleUncheckedCreateWithoutProgramDayInput>
  }

  export type WorkoutScheduleCreateManyProgramDayInputEnvelope = {
    data: WorkoutScheduleCreateManyProgramDayInput | WorkoutScheduleCreateManyProgramDayInput[]
    skipDuplicates?: boolean
  }

  export type WorkoutProgramUpsertWithoutDaysInput = {
    update: XOR<WorkoutProgramUpdateWithoutDaysInput, WorkoutProgramUncheckedUpdateWithoutDaysInput>
    create: XOR<WorkoutProgramCreateWithoutDaysInput, WorkoutProgramUncheckedCreateWithoutDaysInput>
    where?: WorkoutProgramWhereInput
  }

  export type WorkoutProgramUpdateToOneWithWhereWithoutDaysInput = {
    where?: WorkoutProgramWhereInput
    data: XOR<WorkoutProgramUpdateWithoutDaysInput, WorkoutProgramUncheckedUpdateWithoutDaysInput>
  }

  export type WorkoutProgramUpdateWithoutDaysInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type WorkoutProgramUncheckedUpdateWithoutDaysInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type WorkoutProgramExerciseUpsertWithWhereUniqueWithoutProgramDayInput = {
    where: WorkoutProgramExerciseWhereUniqueInput
    update: XOR<WorkoutProgramExerciseUpdateWithoutProgramDayInput, WorkoutProgramExerciseUncheckedUpdateWithoutProgramDayInput>
    create: XOR<WorkoutProgramExerciseCreateWithoutProgramDayInput, WorkoutProgramExerciseUncheckedCreateWithoutProgramDayInput>
  }

  export type WorkoutProgramExerciseUpdateWithWhereUniqueWithoutProgramDayInput = {
    where: WorkoutProgramExerciseWhereUniqueInput
    data: XOR<WorkoutProgramExerciseUpdateWithoutProgramDayInput, WorkoutProgramExerciseUncheckedUpdateWithoutProgramDayInput>
  }

  export type WorkoutProgramExerciseUpdateManyWithWhereWithoutProgramDayInput = {
    where: WorkoutProgramExerciseScalarWhereInput
    data: XOR<WorkoutProgramExerciseUpdateManyMutationInput, WorkoutProgramExerciseUncheckedUpdateManyWithoutProgramDayInput>
  }

  export type WorkoutScheduleUpsertWithWhereUniqueWithoutProgramDayInput = {
    where: WorkoutScheduleWhereUniqueInput
    update: XOR<WorkoutScheduleUpdateWithoutProgramDayInput, WorkoutScheduleUncheckedUpdateWithoutProgramDayInput>
    create: XOR<WorkoutScheduleCreateWithoutProgramDayInput, WorkoutScheduleUncheckedCreateWithoutProgramDayInput>
  }

  export type WorkoutScheduleUpdateWithWhereUniqueWithoutProgramDayInput = {
    where: WorkoutScheduleWhereUniqueInput
    data: XOR<WorkoutScheduleUpdateWithoutProgramDayInput, WorkoutScheduleUncheckedUpdateWithoutProgramDayInput>
  }

  export type WorkoutScheduleUpdateManyWithWhereWithoutProgramDayInput = {
    where: WorkoutScheduleScalarWhereInput
    data: XOR<WorkoutScheduleUpdateManyMutationInput, WorkoutScheduleUncheckedUpdateManyWithoutProgramDayInput>
  }

  export type WorkoutProgramDayCreateWithoutExercisesInput = {
    id?: string
    dayNumber: number
    title: string
    description?: string | null
    duration?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
    program: WorkoutProgramCreateNestedOneWithoutDaysInput
    schedules?: WorkoutScheduleCreateNestedManyWithoutProgramDayInput
  }

  export type WorkoutProgramDayUncheckedCreateWithoutExercisesInput = {
    id?: string
    programId: string
    dayNumber: number
    title: string
    description?: string | null
    duration?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
    schedules?: WorkoutScheduleUncheckedCreateNestedManyWithoutProgramDayInput
  }

  export type WorkoutProgramDayCreateOrConnectWithoutExercisesInput = {
    where: WorkoutProgramDayWhereUniqueInput
    create: XOR<WorkoutProgramDayCreateWithoutExercisesInput, WorkoutProgramDayUncheckedCreateWithoutExercisesInput>
  }

  export type ExerciseCreateWithoutWorkoutProgramExercisesInput = {
    id?: string
    exerciseName: string
    typeOfActivity: $Enums.ExerciseType
    typeOfEquipment: $Enums.EquipmentType
    bodyPart: $Enums.BodyPart
    type: $Enums.MovementType
    muscleGroupsActivated?: ExerciseCreatemuscleGroupsActivatedInput | string[]
    instructions: string
    videoUrl?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    workoutExercises?: WorkoutExerciseCreateNestedManyWithoutExerciseInput
  }

  export type ExerciseUncheckedCreateWithoutWorkoutProgramExercisesInput = {
    id?: string
    exerciseName: string
    typeOfActivity: $Enums.ExerciseType
    typeOfEquipment: $Enums.EquipmentType
    bodyPart: $Enums.BodyPart
    type: $Enums.MovementType
    muscleGroupsActivated?: ExerciseCreatemuscleGroupsActivatedInput | string[]
    instructions: string
    videoUrl?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    workoutExercises?: WorkoutExerciseUncheckedCreateNestedManyWithoutExerciseInput
  }

  export type ExerciseCreateOrConnectWithoutWorkoutProgramExercisesInput = {
    where: ExerciseWhereUniqueInput
    create: XOR<ExerciseCreateWithoutWorkoutProgramExercisesInput, ExerciseUncheckedCreateWithoutWorkoutProgramExercisesInput>
  }

  export type WorkoutProgramDayUpsertWithoutExercisesInput = {
    update: XOR<WorkoutProgramDayUpdateWithoutExercisesInput, WorkoutProgramDayUncheckedUpdateWithoutExercisesInput>
    create: XOR<WorkoutProgramDayCreateWithoutExercisesInput, WorkoutProgramDayUncheckedCreateWithoutExercisesInput>
    where?: WorkoutProgramDayWhereInput
  }

  export type WorkoutProgramDayUpdateToOneWithWhereWithoutExercisesInput = {
    where?: WorkoutProgramDayWhereInput
    data: XOR<WorkoutProgramDayUpdateWithoutExercisesInput, WorkoutProgramDayUncheckedUpdateWithoutExercisesInput>
  }

  export type WorkoutProgramDayUpdateWithoutExercisesInput = {
    id?: StringFieldUpdateOperationsInput | string
    dayNumber?: IntFieldUpdateOperationsInput | number
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    program?: WorkoutProgramUpdateOneRequiredWithoutDaysNestedInput
    schedules?: WorkoutScheduleUpdateManyWithoutProgramDayNestedInput
  }

  export type WorkoutProgramDayUncheckedUpdateWithoutExercisesInput = {
    id?: StringFieldUpdateOperationsInput | string
    programId?: StringFieldUpdateOperationsInput | string
    dayNumber?: IntFieldUpdateOperationsInput | number
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    schedules?: WorkoutScheduleUncheckedUpdateManyWithoutProgramDayNestedInput
  }

  export type ExerciseUpsertWithoutWorkoutProgramExercisesInput = {
    update: XOR<ExerciseUpdateWithoutWorkoutProgramExercisesInput, ExerciseUncheckedUpdateWithoutWorkoutProgramExercisesInput>
    create: XOR<ExerciseCreateWithoutWorkoutProgramExercisesInput, ExerciseUncheckedCreateWithoutWorkoutProgramExercisesInput>
    where?: ExerciseWhereInput
  }

  export type ExerciseUpdateToOneWithWhereWithoutWorkoutProgramExercisesInput = {
    where?: ExerciseWhereInput
    data: XOR<ExerciseUpdateWithoutWorkoutProgramExercisesInput, ExerciseUncheckedUpdateWithoutWorkoutProgramExercisesInput>
  }

  export type ExerciseUpdateWithoutWorkoutProgramExercisesInput = {
    id?: StringFieldUpdateOperationsInput | string
    exerciseName?: StringFieldUpdateOperationsInput | string
    typeOfActivity?: EnumExerciseTypeFieldUpdateOperationsInput | $Enums.ExerciseType
    typeOfEquipment?: EnumEquipmentTypeFieldUpdateOperationsInput | $Enums.EquipmentType
    bodyPart?: EnumBodyPartFieldUpdateOperationsInput | $Enums.BodyPart
    type?: EnumMovementTypeFieldUpdateOperationsInput | $Enums.MovementType
    muscleGroupsActivated?: ExerciseUpdatemuscleGroupsActivatedInput | string[]
    instructions?: StringFieldUpdateOperationsInput | string
    videoUrl?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    workoutExercises?: WorkoutExerciseUpdateManyWithoutExerciseNestedInput
  }

  export type ExerciseUncheckedUpdateWithoutWorkoutProgramExercisesInput = {
    id?: StringFieldUpdateOperationsInput | string
    exerciseName?: StringFieldUpdateOperationsInput | string
    typeOfActivity?: EnumExerciseTypeFieldUpdateOperationsInput | $Enums.ExerciseType
    typeOfEquipment?: EnumEquipmentTypeFieldUpdateOperationsInput | $Enums.EquipmentType
    bodyPart?: EnumBodyPartFieldUpdateOperationsInput | $Enums.BodyPart
    type?: EnumMovementTypeFieldUpdateOperationsInput | $Enums.MovementType
    muscleGroupsActivated?: ExerciseUpdatemuscleGroupsActivatedInput | string[]
    instructions?: StringFieldUpdateOperationsInput | string
    videoUrl?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    workoutExercises?: WorkoutExerciseUncheckedUpdateManyWithoutExerciseNestedInput
  }

  export type WorkoutProgramDayCreateWithoutSchedulesInput = {
    id?: string
    dayNumber: number
    title: string
    description?: string | null
    duration?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
    program: WorkoutProgramCreateNestedOneWithoutDaysInput
    exercises?: WorkoutProgramExerciseCreateNestedManyWithoutProgramDayInput
  }

  export type WorkoutProgramDayUncheckedCreateWithoutSchedulesInput = {
    id?: string
    programId: string
    dayNumber: number
    title: string
    description?: string | null
    duration?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
    exercises?: WorkoutProgramExerciseUncheckedCreateNestedManyWithoutProgramDayInput
  }

  export type WorkoutProgramDayCreateOrConnectWithoutSchedulesInput = {
    where: WorkoutProgramDayWhereUniqueInput
    create: XOR<WorkoutProgramDayCreateWithoutSchedulesInput, WorkoutProgramDayUncheckedCreateWithoutSchedulesInput>
  }

  export type WorkoutCreateWithoutSchedulesInput = {
    id?: string
    userId: string
    name: string
    description?: string | null
    date?: Date | string
    duration?: number | null
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    exercises?: WorkoutExerciseCreateNestedManyWithoutWorkoutInput
  }

  export type WorkoutUncheckedCreateWithoutSchedulesInput = {
    id?: string
    userId: string
    name: string
    description?: string | null
    date?: Date | string
    duration?: number | null
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    exercises?: WorkoutExerciseUncheckedCreateNestedManyWithoutWorkoutInput
  }

  export type WorkoutCreateOrConnectWithoutSchedulesInput = {
    where: WorkoutWhereUniqueInput
    create: XOR<WorkoutCreateWithoutSchedulesInput, WorkoutUncheckedCreateWithoutSchedulesInput>
  }

  export type WorkoutProgramDayUpsertWithoutSchedulesInput = {
    update: XOR<WorkoutProgramDayUpdateWithoutSchedulesInput, WorkoutProgramDayUncheckedUpdateWithoutSchedulesInput>
    create: XOR<WorkoutProgramDayCreateWithoutSchedulesInput, WorkoutProgramDayUncheckedCreateWithoutSchedulesInput>
    where?: WorkoutProgramDayWhereInput
  }

  export type WorkoutProgramDayUpdateToOneWithWhereWithoutSchedulesInput = {
    where?: WorkoutProgramDayWhereInput
    data: XOR<WorkoutProgramDayUpdateWithoutSchedulesInput, WorkoutProgramDayUncheckedUpdateWithoutSchedulesInput>
  }

  export type WorkoutProgramDayUpdateWithoutSchedulesInput = {
    id?: StringFieldUpdateOperationsInput | string
    dayNumber?: IntFieldUpdateOperationsInput | number
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    program?: WorkoutProgramUpdateOneRequiredWithoutDaysNestedInput
    exercises?: WorkoutProgramExerciseUpdateManyWithoutProgramDayNestedInput
  }

  export type WorkoutProgramDayUncheckedUpdateWithoutSchedulesInput = {
    id?: StringFieldUpdateOperationsInput | string
    programId?: StringFieldUpdateOperationsInput | string
    dayNumber?: IntFieldUpdateOperationsInput | number
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    exercises?: WorkoutProgramExerciseUncheckedUpdateManyWithoutProgramDayNestedInput
  }

  export type WorkoutUpsertWithoutSchedulesInput = {
    update: XOR<WorkoutUpdateWithoutSchedulesInput, WorkoutUncheckedUpdateWithoutSchedulesInput>
    create: XOR<WorkoutCreateWithoutSchedulesInput, WorkoutUncheckedCreateWithoutSchedulesInput>
    where?: WorkoutWhereInput
  }

  export type WorkoutUpdateToOneWithWhereWithoutSchedulesInput = {
    where?: WorkoutWhereInput
    data: XOR<WorkoutUpdateWithoutSchedulesInput, WorkoutUncheckedUpdateWithoutSchedulesInput>
  }

  export type WorkoutUpdateWithoutSchedulesInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    exercises?: WorkoutExerciseUpdateManyWithoutWorkoutNestedInput
  }

  export type WorkoutUncheckedUpdateWithoutSchedulesInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    exercises?: WorkoutExerciseUncheckedUpdateManyWithoutWorkoutNestedInput
  }

  export type WorkoutExerciseCreateManyExerciseInput = {
    id?: string
    workoutId: string
    sets: number
    reps?: number | null
    duration?: number | null
    weight?: number | null
    notes?: string | null
    order?: number
    createdAt?: Date | string
  }

  export type WorkoutProgramExerciseCreateManyExerciseInput = {
    id?: string
    programDayId: string
    order?: number
    sets?: number | null
    reps?: number | null
    weight?: number | null
    duration?: number | null
    restSeconds?: number | null
    notes?: string | null
    createdAt?: Date | string
  }

  export type WorkoutExerciseUpdateWithoutExerciseInput = {
    id?: StringFieldUpdateOperationsInput | string
    sets?: IntFieldUpdateOperationsInput | number
    reps?: NullableIntFieldUpdateOperationsInput | number | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    weight?: NullableFloatFieldUpdateOperationsInput | number | null
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    order?: IntFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    workout?: WorkoutUpdateOneRequiredWithoutExercisesNestedInput
    workoutSets?: WorkoutSetUpdateManyWithoutWorkoutExerciseNestedInput
  }

  export type WorkoutExerciseUncheckedUpdateWithoutExerciseInput = {
    id?: StringFieldUpdateOperationsInput | string
    workoutId?: StringFieldUpdateOperationsInput | string
    sets?: IntFieldUpdateOperationsInput | number
    reps?: NullableIntFieldUpdateOperationsInput | number | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    weight?: NullableFloatFieldUpdateOperationsInput | number | null
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    order?: IntFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    workoutSets?: WorkoutSetUncheckedUpdateManyWithoutWorkoutExerciseNestedInput
  }

  export type WorkoutExerciseUncheckedUpdateManyWithoutExerciseInput = {
    id?: StringFieldUpdateOperationsInput | string
    workoutId?: StringFieldUpdateOperationsInput | string
    sets?: IntFieldUpdateOperationsInput | number
    reps?: NullableIntFieldUpdateOperationsInput | number | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    weight?: NullableFloatFieldUpdateOperationsInput | number | null
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    order?: IntFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type WorkoutProgramExerciseUpdateWithoutExerciseInput = {
    id?: StringFieldUpdateOperationsInput | string
    order?: IntFieldUpdateOperationsInput | number
    sets?: NullableIntFieldUpdateOperationsInput | number | null
    reps?: NullableIntFieldUpdateOperationsInput | number | null
    weight?: NullableFloatFieldUpdateOperationsInput | number | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    restSeconds?: NullableIntFieldUpdateOperationsInput | number | null
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    programDay?: WorkoutProgramDayUpdateOneRequiredWithoutExercisesNestedInput
  }

  export type WorkoutProgramExerciseUncheckedUpdateWithoutExerciseInput = {
    id?: StringFieldUpdateOperationsInput | string
    programDayId?: StringFieldUpdateOperationsInput | string
    order?: IntFieldUpdateOperationsInput | number
    sets?: NullableIntFieldUpdateOperationsInput | number | null
    reps?: NullableIntFieldUpdateOperationsInput | number | null
    weight?: NullableFloatFieldUpdateOperationsInput | number | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    restSeconds?: NullableIntFieldUpdateOperationsInput | number | null
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type WorkoutProgramExerciseUncheckedUpdateManyWithoutExerciseInput = {
    id?: StringFieldUpdateOperationsInput | string
    programDayId?: StringFieldUpdateOperationsInput | string
    order?: IntFieldUpdateOperationsInput | number
    sets?: NullableIntFieldUpdateOperationsInput | number | null
    reps?: NullableIntFieldUpdateOperationsInput | number | null
    weight?: NullableFloatFieldUpdateOperationsInput | number | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    restSeconds?: NullableIntFieldUpdateOperationsInput | number | null
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type WorkoutExerciseCreateManyWorkoutInput = {
    id?: string
    exerciseId: string
    sets: number
    reps?: number | null
    duration?: number | null
    weight?: number | null
    notes?: string | null
    order?: number
    createdAt?: Date | string
  }

  export type WorkoutScheduleCreateManyWorkoutInput = {
    id?: string
    userId: string
    date: Date | string
    programDayId?: string | null
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type WorkoutExerciseUpdateWithoutWorkoutInput = {
    id?: StringFieldUpdateOperationsInput | string
    sets?: IntFieldUpdateOperationsInput | number
    reps?: NullableIntFieldUpdateOperationsInput | number | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    weight?: NullableFloatFieldUpdateOperationsInput | number | null
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    order?: IntFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    exercise?: ExerciseUpdateOneRequiredWithoutWorkoutExercisesNestedInput
    workoutSets?: WorkoutSetUpdateManyWithoutWorkoutExerciseNestedInput
  }

  export type WorkoutExerciseUncheckedUpdateWithoutWorkoutInput = {
    id?: StringFieldUpdateOperationsInput | string
    exerciseId?: StringFieldUpdateOperationsInput | string
    sets?: IntFieldUpdateOperationsInput | number
    reps?: NullableIntFieldUpdateOperationsInput | number | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    weight?: NullableFloatFieldUpdateOperationsInput | number | null
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    order?: IntFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    workoutSets?: WorkoutSetUncheckedUpdateManyWithoutWorkoutExerciseNestedInput
  }

  export type WorkoutExerciseUncheckedUpdateManyWithoutWorkoutInput = {
    id?: StringFieldUpdateOperationsInput | string
    exerciseId?: StringFieldUpdateOperationsInput | string
    sets?: IntFieldUpdateOperationsInput | number
    reps?: NullableIntFieldUpdateOperationsInput | number | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    weight?: NullableFloatFieldUpdateOperationsInput | number | null
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    order?: IntFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type WorkoutScheduleUpdateWithoutWorkoutInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    programDay?: WorkoutProgramDayUpdateOneWithoutSchedulesNestedInput
  }

  export type WorkoutScheduleUncheckedUpdateWithoutWorkoutInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    programDayId?: NullableStringFieldUpdateOperationsInput | string | null
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type WorkoutScheduleUncheckedUpdateManyWithoutWorkoutInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    programDayId?: NullableStringFieldUpdateOperationsInput | string | null
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type WorkoutSetCreateManyWorkoutExerciseInput = {
    id?: string
    setNumber: number
    reps?: number | null
    weight?: number | null
    rpe?: number | null
    completed?: boolean
    createdAt?: Date | string
  }

  export type WorkoutSetUpdateWithoutWorkoutExerciseInput = {
    id?: StringFieldUpdateOperationsInput | string
    setNumber?: IntFieldUpdateOperationsInput | number
    reps?: NullableIntFieldUpdateOperationsInput | number | null
    weight?: NullableFloatFieldUpdateOperationsInput | number | null
    rpe?: NullableFloatFieldUpdateOperationsInput | number | null
    completed?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type WorkoutSetUncheckedUpdateWithoutWorkoutExerciseInput = {
    id?: StringFieldUpdateOperationsInput | string
    setNumber?: IntFieldUpdateOperationsInput | number
    reps?: NullableIntFieldUpdateOperationsInput | number | null
    weight?: NullableFloatFieldUpdateOperationsInput | number | null
    rpe?: NullableFloatFieldUpdateOperationsInput | number | null
    completed?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type WorkoutSetUncheckedUpdateManyWithoutWorkoutExerciseInput = {
    id?: StringFieldUpdateOperationsInput | string
    setNumber?: IntFieldUpdateOperationsInput | number
    reps?: NullableIntFieldUpdateOperationsInput | number | null
    weight?: NullableFloatFieldUpdateOperationsInput | number | null
    rpe?: NullableFloatFieldUpdateOperationsInput | number | null
    completed?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type WorkoutProgramDayCreateManyProgramInput = {
    id?: string
    dayNumber: number
    title: string
    description?: string | null
    duration?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type WorkoutProgramDayUpdateWithoutProgramInput = {
    id?: StringFieldUpdateOperationsInput | string
    dayNumber?: IntFieldUpdateOperationsInput | number
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    exercises?: WorkoutProgramExerciseUpdateManyWithoutProgramDayNestedInput
    schedules?: WorkoutScheduleUpdateManyWithoutProgramDayNestedInput
  }

  export type WorkoutProgramDayUncheckedUpdateWithoutProgramInput = {
    id?: StringFieldUpdateOperationsInput | string
    dayNumber?: IntFieldUpdateOperationsInput | number
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    exercises?: WorkoutProgramExerciseUncheckedUpdateManyWithoutProgramDayNestedInput
    schedules?: WorkoutScheduleUncheckedUpdateManyWithoutProgramDayNestedInput
  }

  export type WorkoutProgramDayUncheckedUpdateManyWithoutProgramInput = {
    id?: StringFieldUpdateOperationsInput | string
    dayNumber?: IntFieldUpdateOperationsInput | number
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type WorkoutProgramExerciseCreateManyProgramDayInput = {
    id?: string
    exerciseId: string
    order?: number
    sets?: number | null
    reps?: number | null
    weight?: number | null
    duration?: number | null
    restSeconds?: number | null
    notes?: string | null
    createdAt?: Date | string
  }

  export type WorkoutScheduleCreateManyProgramDayInput = {
    id?: string
    userId: string
    date: Date | string
    workoutId?: string | null
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type WorkoutProgramExerciseUpdateWithoutProgramDayInput = {
    id?: StringFieldUpdateOperationsInput | string
    order?: IntFieldUpdateOperationsInput | number
    sets?: NullableIntFieldUpdateOperationsInput | number | null
    reps?: NullableIntFieldUpdateOperationsInput | number | null
    weight?: NullableFloatFieldUpdateOperationsInput | number | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    restSeconds?: NullableIntFieldUpdateOperationsInput | number | null
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    exercise?: ExerciseUpdateOneRequiredWithoutWorkoutProgramExercisesNestedInput
  }

  export type WorkoutProgramExerciseUncheckedUpdateWithoutProgramDayInput = {
    id?: StringFieldUpdateOperationsInput | string
    exerciseId?: StringFieldUpdateOperationsInput | string
    order?: IntFieldUpdateOperationsInput | number
    sets?: NullableIntFieldUpdateOperationsInput | number | null
    reps?: NullableIntFieldUpdateOperationsInput | number | null
    weight?: NullableFloatFieldUpdateOperationsInput | number | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    restSeconds?: NullableIntFieldUpdateOperationsInput | number | null
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type WorkoutProgramExerciseUncheckedUpdateManyWithoutProgramDayInput = {
    id?: StringFieldUpdateOperationsInput | string
    exerciseId?: StringFieldUpdateOperationsInput | string
    order?: IntFieldUpdateOperationsInput | number
    sets?: NullableIntFieldUpdateOperationsInput | number | null
    reps?: NullableIntFieldUpdateOperationsInput | number | null
    weight?: NullableFloatFieldUpdateOperationsInput | number | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    restSeconds?: NullableIntFieldUpdateOperationsInput | number | null
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type WorkoutScheduleUpdateWithoutProgramDayInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    workout?: WorkoutUpdateOneWithoutSchedulesNestedInput
  }

  export type WorkoutScheduleUncheckedUpdateWithoutProgramDayInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    workoutId?: NullableStringFieldUpdateOperationsInput | string | null
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type WorkoutScheduleUncheckedUpdateManyWithoutProgramDayInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    workoutId?: NullableStringFieldUpdateOperationsInput | string | null
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }



  /**
   * Aliases for legacy arg types
   */
    /**
     * @deprecated Use ExerciseCountOutputTypeDefaultArgs instead
     */
    export type ExerciseCountOutputTypeArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = ExerciseCountOutputTypeDefaultArgs<ExtArgs>
    /**
     * @deprecated Use WorkoutCountOutputTypeDefaultArgs instead
     */
    export type WorkoutCountOutputTypeArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = WorkoutCountOutputTypeDefaultArgs<ExtArgs>
    /**
     * @deprecated Use WorkoutExerciseCountOutputTypeDefaultArgs instead
     */
    export type WorkoutExerciseCountOutputTypeArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = WorkoutExerciseCountOutputTypeDefaultArgs<ExtArgs>
    /**
     * @deprecated Use WorkoutProgramCountOutputTypeDefaultArgs instead
     */
    export type WorkoutProgramCountOutputTypeArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = WorkoutProgramCountOutputTypeDefaultArgs<ExtArgs>
    /**
     * @deprecated Use WorkoutProgramDayCountOutputTypeDefaultArgs instead
     */
    export type WorkoutProgramDayCountOutputTypeArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = WorkoutProgramDayCountOutputTypeDefaultArgs<ExtArgs>
    /**
     * @deprecated Use ExerciseDefaultArgs instead
     */
    export type ExerciseArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = ExerciseDefaultArgs<ExtArgs>
    /**
     * @deprecated Use WorkoutDefaultArgs instead
     */
    export type WorkoutArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = WorkoutDefaultArgs<ExtArgs>
    /**
     * @deprecated Use WorkoutExerciseDefaultArgs instead
     */
    export type WorkoutExerciseArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = WorkoutExerciseDefaultArgs<ExtArgs>
    /**
     * @deprecated Use WorkoutSetDefaultArgs instead
     */
    export type WorkoutSetArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = WorkoutSetDefaultArgs<ExtArgs>
    /**
     * @deprecated Use FoodDefaultArgs instead
     */
    export type FoodArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = FoodDefaultArgs<ExtArgs>
    /**
     * @deprecated Use NutritionLogDefaultArgs instead
     */
    export type NutritionLogArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = NutritionLogDefaultArgs<ExtArgs>
    /**
     * @deprecated Use NutritionGoalDefaultArgs instead
     */
    export type NutritionGoalArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = NutritionGoalDefaultArgs<ExtArgs>
    /**
     * @deprecated Use BodyMetricsDefaultArgs instead
     */
    export type BodyMetricsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = BodyMetricsDefaultArgs<ExtArgs>
    /**
     * @deprecated Use WorkoutProgramDefaultArgs instead
     */
    export type WorkoutProgramArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = WorkoutProgramDefaultArgs<ExtArgs>
    /**
     * @deprecated Use WorkoutProgramDayDefaultArgs instead
     */
    export type WorkoutProgramDayArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = WorkoutProgramDayDefaultArgs<ExtArgs>
    /**
     * @deprecated Use WorkoutProgramExerciseDefaultArgs instead
     */
    export type WorkoutProgramExerciseArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = WorkoutProgramExerciseDefaultArgs<ExtArgs>
    /**
     * @deprecated Use WorkoutScheduleDefaultArgs instead
     */
    export type WorkoutScheduleArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = WorkoutScheduleDefaultArgs<ExtArgs>

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