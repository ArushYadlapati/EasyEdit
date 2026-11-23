// The preview's sound clean-up, run by the browser's audio engine beside the page. One processor, in one of two
// modes: "clip" cleans one clip's sound to the settings the page sends it; "limit" holds the whole mix under its
// ceiling. The clean-up itself is clean-dsp.js, made from the same source the export runs.
import { createChain, createLimiter } from "./clean-dsp.js";

class CleanProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const limit = options?.processorOptions?.mode === "limit";
    this.chain = limit ? null : createChain(sampleRate);
    this.limiter = limit ? createLimiter(sampleRate) : null;
    this.port.onmessage = (event) => this.chain?.set(event.data);
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0 || output.length < 2) return true;
    // Always two sides out: a one-sided sound is heard on both.
    output[0].set(input[0]);
    output[1].set(input[1] ?? input[0]);
    (this.chain ?? this.limiter).process(output[0], output[1]);
    return true;
  }
}

registerProcessor("easyedit-clean", CleanProcessor);
