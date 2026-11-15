// Anyone with a verified Google email may make an account only when this is switched on. Off, the allowlist decides.
export function openSignUp(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OPEN_SIGNUP === "true";
}
