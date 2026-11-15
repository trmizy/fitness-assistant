/**
 * TEST-ONLY process driver for the annotation CLI (never used by operators): runs `main` in a real, separate process so the
 * tests can exercise cross-process contention and a process KILLED in the middle of publication (no handled rollback).
 *   M7_TEST_KILL_AFTER_LINK=<file name>  → the process kills itself (SIGKILL) right after linking that bundle member.
 * The CLI itself reads no environment variables.
 */
import { main, testHooks } from "./annotation-cli";

const kill = process.env.M7_TEST_KILL_AFTER_LINK;
if (kill) testHooks.afterLink = (_target, name) => { if (name === kill) process.kill(process.pid, "SIGKILL"); };
process.exit(main(process.argv.slice(2)));
