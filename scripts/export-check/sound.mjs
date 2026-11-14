// The rules and parsers behind the check script's sound checks. Pure: it reads
// no file and runs no program. verify.mjs hands it what ffprobe and ffmpeg print.
//
// The thresholds are fixed before any real file is checked. When a real export
// fails one, the numbers go to the owner; a threshold is never tuned to make a
// file pass.

export const SOUND_RULES = Object.freeze({
  // --sound passes when the loudest sample is over this.
  soundMinDb: -60,
  // --silent passes when the loudest sample is at or under this.
  silentMaxDb: -90,
  // silencedetect's noise floor for finding where the sound starts.
  onsetDb: -50,
  // How far the sound may start from its frame, either way.
  onsetSeconds: 0.021,
});

// A silence that opens this close to the track's start opens the track.
const OPENS_AT = 0.001;

/**
 * @typedef {object} AudioStream  the fields of ffprobe's audio stream the format check reads
 * @property {string} codec_name
 * @property {string} [profile]
 * @property {string} sample_rate  ffprobe prints it as a string
 * @property {number} channels
 */

/**
 * What is wrong with a sound track's format, one text per problem, in the order
 * codec, profile, sample rate, channels. Empty for AAC-LC at 48,000 Hz in stereo.
 * @param {AudioStream} stream
 * @returns {string[]}
 */
export function audioFormatProblems(stream) {
  const problems = [];
  if (stream.codec_name !== "aac") problems.push(`codec ${stream.codec_name ?? "none"}`);
  if (stream.profile !== "LC") problems.push(`profile ${stream.profile ?? "none"}`);
  if (stream.sample_rate !== "48000") problems.push(`sample rate ${stream.sample_rate ?? "none"}`);
  if (stream.channels !== 2) problems.push(`channels ${stream.channels ?? "none"}`);
  return problems;
}

const MAX_VOLUME = /max_volume:\s*(-?\d+(?:\.\d+)?) dB/;

/**
 * The loudest sample, in dB, from what ffmpeg's volumedetect filter prints.
 * @param {string} log
 * @returns {number | null}  null when the log has no max_volume line
 */
export function parseMaxVolume(log) {
  const match = MAX_VOLUME.exec(log);
  return match ? Number(match[1]) : null;
}

const SILENCE = /silence_(start|end):\s*(-?\d+(?:\.\d+)?(?:e[-+]?\d+)?)/g;

/**
 * Where the sound first starts, in seconds, from what ffmpeg's silencedetect
 * filter prints when run with -copyts (so its times are the stream's own).
 * @param {string} log
 * @param {number} [start]  the audio stream's start_time
 * @returns {number | null}  `start` when the track does not open in silence;
 *   the end of its opening silence when it does; null when that silence never ends
 */
export function parseOnset(log, start = 0) {
  const events = [...log.matchAll(SILENCE)].map((match) => ({ kind: match[1], at: Number(match[2]) }));
  const opening = events.findIndex((event) => event.kind === "start");
  if (opening === -1 || events[opening].at > start + OPENS_AT) return start;
  const end = events.slice(opening + 1).find((event) => event.kind === "end");
  return end ? end.at : null;
}

/**
 * @typedef {object} SoundFlags
 * @property {boolean} sound
 * @property {boolean} silent
 * @property {boolean} noAudio
 * @property {number | null} onset  the frame given to --onset, or null
 */

/**
 * The usage sentence for a combination of sound flags that cannot be checked
 * together, or null when they can.
 * @param {SoundFlags} flags
 * @returns {string | null}
 */
export function soundFlagProblem(flags) {
  if ([flags.sound, flags.silent, flags.noAudio].filter(Boolean).length > 1) return "Give at most one of --sound, --silent and --no-audio.";
  if (flags.onset !== null && (flags.silent || flags.noAudio)) return "--onset needs a sound track: drop --silent or --no-audio.";
  return null;
}
