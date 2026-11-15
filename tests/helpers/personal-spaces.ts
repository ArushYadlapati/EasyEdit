// The suite runs with personal spaces switched on, as they will be once they are offered, so what they do stays
// tested. The tests of the closed state switch them off for themselves (vi.stubEnv("PERSONAL_SPACES", "")).
// TEST_PERSONAL_SPACES=false runs everything closed, as production is today: the tests of personal spaces then fail,
// and anything else that fails is a team flow the closed state broke.
process.env.PERSONAL_SPACES = process.env.TEST_PERSONAL_SPACES ?? "true";
