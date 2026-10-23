// Side-effect module: import it FIRST in a test that drives acceptContract. REQUIRE_CONTRACT_ESIGN is a module-level constant in
// contract.service, read when that module is first loaded, so the env var must be set before any import that pulls it in.
process.env.REQUIRE_CONTRACT_ESIGN = "false";
export {};
