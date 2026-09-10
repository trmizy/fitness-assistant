"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LOADED_CARRY_EXERCISE_NAMES = void 0;
exports.loadedCarryLoggingModeWhere = loadedCarryLoggingModeWhere;
exports.main = main;
const prisma_1 = require("../src/generated/prisma");
const prisma = new prisma_1.PrismaClient();
exports.LOADED_CARRY_EXERCISE_NAMES = [
    "Farmer Carry",
    "Suitcase Carry",
    "Front Rack Carry",
];
function loadedCarryLoggingModeWhere() {
    return {
        exerciseName: { in: [...exports.LOADED_CARRY_EXERCISE_NAMES] },
        movementPattern: "CARRY",
        loggingMode: { not: "TIME_LOAD" },
    };
}
async function main() {
    const result = await prisma.exercise.updateMany({
        where: loadedCarryLoggingModeWhere(),
        data: { loggingMode: "TIME_LOAD" },
    });
    console.log(`Loaded-carry TIME_LOAD correction: ${result.count} row(s) updated.`);
}
if (require.main === module) {
    main()
        .catch((err) => {
        console.error(err);
        process.exit(1);
    })
        .finally(async () => {
        await prisma.$disconnect();
    });
}
//# sourceMappingURL=seed_logging_modes.js.map