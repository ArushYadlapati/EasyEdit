import type { Baked } from "@/lib/color/grade";
import { CURVE_STEPS } from "@/lib/color/grade";

// The last step of drawing a picture, done on the graphics card (WebGL 2): the colour grade (wheels, curves, look-up
// table) and the stylised effects (sharpen, grain, pixelate, colour split, glitch, VHS). A 2D canvas can do none of
// these. The picture comes in as a canvas the size of the frame, with everything else already drawn into it, and goes
// out as another canvas of the same size. The preview, the export worker and a thumbnail all run this same shader.

export type Style = { sharpen: number; grain: number; pixelate: number; split: number; glitch: number; vhs: number };

export type FinishPass = {
  style: Style;
  grade: Baked | null;
  // The project's size, and how many canvas pixels one of its pixels is: every size an effect has is in project
  // pixels, so it is the same share of the picture in a small preview and a full export.
  project: { width: number; height: number };
  scale: number;
  // Seconds into the project. Grain, glitch and VHS change over time, and the same moment always looks the same.
  time: number;
};

// source: a canvas of width × height. The result is a canvas of that size, good until the next call; null where the
// graphics card is not there to do it.
export type Finisher = (source: TexImageSource, width: number, height: number, pass: FinishPass) => CanvasImageSource | null;

// How often the moving effects change, a second: glitch and VHS, and grain (as film does).
export const GLITCH_RATE = 12;
export const GRAIN_RATE = 24;

const VERTEX = `#version 300 es
out vec2 vUv;
void main() {
  // One triangle that covers the frame, made from the corner's number. vUv runs from the picture's top left.
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = vec2(p.x, 1.0 - p.y);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uSource;
uniform sampler2D uCurves;
uniform sampler3D uLut;
uniform vec2 uRes;      // the canvas, in its own pixels
uniform vec2 uProject;  // the project, in project pixels
uniform float uScale;   // canvas pixels per project pixel
uniform float uTime;
uniform float uTick;      // floor(time * GLITCH_RATE)
uniform float uGrainTick; // floor(time * GRAIN_RATE)
uniform float uSharpen;
uniform float uGrain;
uniform float uPixelate;
uniform float uSplit;
uniform float uGlitch;
uniform float uVhs;
uniform float uWheels;
uniform vec3 uLift;
uniform vec3 uGamma;
uniform vec3 uGain;
uniform float uHasCurves;
uniform float uLutAmount;
uniform float uLutSize;

// A random number, 0 to 1, from three whole numbers. Whole-number maths, so every graphics card gives the same one.
uvec3 pcg(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
float rnd(vec3 p) {
  return float(pcg(uvec3(ivec3(floor(p)) + ivec3(65536))).x) * (1.0 / 4294967295.0);
}

// The picture at a place, its red and blue taken from either side when the colours are split.
vec4 take(vec2 uv, float spread) {
  vec4 c = texture(uSource, uv);
  if (spread > 0.0) {
    vec4 r = texture(uSource, uv + vec2(spread, 0.0));
    vec4 b = texture(uSource, uv - vec2(spread, 0.0));
    c = vec4(r.r, c.g, b.b, max(c.a, max(r.a, b.a)));
  }
  return c;
}

void main() {
  vec2 px = vUv * uProject;
  vec2 uv = vUv;
  if (uPixelate > 1.0) {
    px = (floor(px / uPixelate) + 0.5) * uPixelate;
    uv = px / uProject;
  }

  float shift = 0.0;            // rows pushed sideways, in widths of the picture
  float spread = uSplit * 0.02; // red and blue pulled apart, in widths
  float noise = 0.0;
  float tapeLine = max(1.0, uProject.y / 360.0);

  if (uGlitch > 0.0) {
    // Bands of rows, a new set of heights each tick. Some bands jump sideways; some ticks are calm.
    float bandHeight = uProject.y / mix(6.0, 28.0, rnd(vec3(uTick, 3.0, 0.0)));
    float band = floor(px.y / bandHeight);
    float calm = step(rnd(vec3(uTick, 11.0, 0.0)), 0.35 - 0.3 * uGlitch);
    float jump = (1.0 - calm) * step(1.0 - 0.55 * uGlitch, rnd(vec3(band, uTick, 7.0)));
    shift += jump * (rnd(vec3(band, uTick, 19.0)) - 0.5) * 0.25 * uGlitch;
    spread += (0.004 + 0.02 * jump) * uGlitch;
  }
  float tracking = 0.0;
  if (uVhs > 0.0) {
    // Each tape line wobbles a little, and a band of bad tracking rolls up the picture.
    float row = floor(px.y / tapeLine);
    shift += (rnd(vec3(row, uTick, 23.0)) - 0.5) * 0.004 * uVhs;
    float from = abs(vUv.y - fract(1.0 - uTime * 0.11));
    tracking = smoothstep(0.06, 0.0, min(from, 1.0 - from));
    shift += tracking * (rnd(vec3(row, uTick, 29.0)) - 0.3) * 0.03 * uVhs;
    spread += 0.003 * uVhs;
  }
  uv.x += shift;

  vec4 c = take(uv, spread);
  if (uVhs > 0.0) {
    // Tape smears sideways.
    vec2 o = vec2((0.75 + 1.5 * uVhs) / uProject.x, 0.0);
    c = (c * 2.0 + take(uv + o, spread) + take(uv - o, spread)) * 0.25;
  }
  if (uSharpen > 0.0) {
    // What the picture has here that its four neighbours do not is added back on top.
    vec2 o = max(1.0 / uProject, 1.0 / uRes);
    vec4 mid = texture(uSource, uv);
    vec4 around = texture(uSource, uv + vec2(o.x, 0.0)) + texture(uSource, uv - vec2(o.x, 0.0)) + texture(uSource, uv + vec2(0.0, o.y)) + texture(uSource, uv - vec2(0.0, o.y));
    c.rgb += (mid.rgb * 4.0 - around.rgb) * uSharpen * 0.8;
  }

  // The canvas hands its colours over already multiplied by how solid they are; colour maths wants them plain.
  float a = c.a;
  vec3 rgb = a > 0.0 ? clamp(c.rgb / a, 0.0, 1.0) : vec3(0.0);

  if (uWheels > 0.5) {
    rgb = clamp((rgb + uLift * (1.0 - rgb)) * uGain, 0.0, 1.0);
    rgb = pow(rgb, 1.0 / uGamma);
  }
  if (uHasCurves > 0.5) {
    vec3 at = (rgb * ${CURVE_STEPS - 1}.0 + 0.5) / ${CURVE_STEPS}.0;
    rgb = vec3(texture(uCurves, vec2(at.r, 0.5)).r, texture(uCurves, vec2(at.g, 0.5)).g, texture(uCurves, vec2(at.b, 0.5)).b);
  }
  if (uLutAmount > 0.0) {
    vec3 at = (rgb * (uLutSize - 1.0) + 0.5) / uLutSize;
    rgb = mix(rgb, texture(uLut, at).rgb, uLutAmount);
  }

  if (uVhs > 0.0) {
    float light = dot(rgb, vec3(0.299, 0.587, 0.114));
    rgb = mix(vec3(light), rgb, 1.0 - 0.3 * uVhs);
    rgb = rgb * (1.0 - 0.06 * uVhs) + 0.04 * uVhs;
    // Scan lines, never finer than three canvas pixels, so a small preview shows lines and not a shimmer.
    float cycle = max(uProject.y / 240.0, 3.0 / uScale);
    rgb *= 1.0 - 0.22 * uVhs * (0.5 + 0.5 * cos(px.y / cycle * 6.2831853));
    noise += (0.07 + 0.3 * tracking) * uVhs;
  }
  if (uGrain > 0.0 || noise > 0.0) {
    // A speck is a pixel and a half of a 720-line picture, never smaller than a canvas pixel. Grain shows most in the
    // middle tones, as on film.
    float speck = max(max(1.0, uProject.y / 480.0), 1.0 / uScale);
    float n = rnd(vec3(floor(px / speck), uGrainTick)) - 0.5;
    float light = dot(rgb, vec3(0.299, 0.587, 0.114));
    rgb += n * (uGrain * 0.35 * (0.4 + 2.4 * light * (1.0 - light)) + noise);
  }

  rgb = clamp(rgb, 0.0, 1.0);
  outColor = vec4(rgb * a, a);
}`;

type GlCanvas = OffscreenCanvas | HTMLCanvasElement;

type State = {
  canvas: GlCanvas;
  gl: WebGL2RenderingContext;
  at: Record<string, WebGLUniformLocation | null>;
  source: WebGLTexture;
  curves: WebGLTexture;
  curvesOf: Uint8Array | null;
  luts: Map<Uint8Array, WebGLTexture>;
};

const UNIFORMS = [
  "uSource", "uCurves", "uLut", "uRes", "uProject", "uScale", "uTime", "uTick", "uGrainTick", "uSharpen", "uGrain", "uPixelate", "uSplit", "uGlitch", "uVhs",
  "uWheels", "uLift", "uGamma", "uGain", "uHasCurves", "uLutAmount", "uLutSize",
] as const;

// The most look-up tables kept on the graphics card at once; a project has at most a handful.
const LUTS_KEPT = 12;

function compile(gl: WebGL2RenderingContext, type: number, text: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, text);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  console.warn("EasyEdit: the effects shader did not compile", gl.getShaderInfoLog(shader));
  return null;
}

function plainTexture(gl: WebGL2RenderingContext, target: number): WebGLTexture {
  const texture = gl.createTexture()!;
  gl.bindTexture(target, texture);
  gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (target === gl.TEXTURE_3D) gl.texParameteri(target, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
  return texture;
}

function start(canvas: GlCanvas): State | null {
  const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true }) as WebGL2RenderingContext | null;
  if (!gl) return null;
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn("EasyEdit: the effects shader did not link", gl.getProgramInfoLog(program));
    return null;
  }
  gl.useProgram(program);
  gl.bindVertexArray(gl.createVertexArray());
  const at: State["at"] = {};
  for (const name of UNIFORMS) at[name] = gl.getUniformLocation(program, name);
  gl.uniform1i(at.uSource, 0);
  gl.uniform1i(at.uCurves, 1);
  gl.uniform1i(at.uLut, 2);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.disable(gl.BLEND);
  gl.activeTexture(gl.TEXTURE0);
  const source = plainTexture(gl, gl.TEXTURE_2D);
  gl.activeTexture(gl.TEXTURE1);
  const curves = plainTexture(gl, gl.TEXTURE_2D);
  // Every sampler has something to read, used or not.
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
  gl.activeTexture(gl.TEXTURE2);
  plainTexture(gl, gl.TEXTURE_3D);
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB8, 1, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0]));
  return { canvas, gl, at, source, curves, curvesOf: null, luts: new Map() };
}

function lutTexture(state: State, lut: { size: number; data: Uint8Array }): WebGLTexture {
  const { gl, luts } = state;
  const kept = luts.get(lut.data);
  if (kept) {
    gl.bindTexture(gl.TEXTURE_3D, kept);
    return kept;
  }
  if (luts.size >= LUTS_KEPT) {
    const [oldest, texture] = luts.entries().next().value!;
    gl.deleteTexture(texture);
    luts.delete(oldest);
  }
  const texture = plainTexture(gl, gl.TEXTURE_3D);
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB8, lut.size, lut.size, lut.size, 0, gl.RGB, gl.UNSIGNED_BYTE, lut.data);
  luts.set(lut.data, texture);
  return texture;
}

function defaultCanvas(width: number, height: number): GlCanvas | null {
  return typeof OffscreenCanvas === "undefined" ? null : new OffscreenCanvas(width, height);
}

// A finisher on a canvas of its own. The graphics card is asked for only when the first picture needs it; where it
// says no, every call gives null and the picture is drawn without these effects.
export function createFinisher(makeCanvas: (width: number, height: number) => GlCanvas | null = defaultCanvas): Finisher {
  let state: State | null = null;
  let failed = false;
  return (source, width, height, pass) => {
    if (failed) return null;
    if (state && state.gl.isContextLost()) state = null; // the card was taken away: start again on a new canvas
    if (!state) {
      const canvas = makeCanvas(width, height);
      try {
        state = canvas ? start(canvas) : null;
      } catch {
        state = null;
      }
      if (!state) {
        failed = true;
        return null;
      }
    }
    const { gl, at, canvas } = state;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, state.source);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

    const { style, grade } = pass;
    if (grade?.curves && grade.curves !== state.curvesOf) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, state.curves);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, CURVE_STEPS, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, grade.curves);
      state.curvesOf = grade.curves;
    }
    const lut = grade?.lut && grade.lutAmount > 0 ? grade.lut : null;
    if (lut) {
      gl.activeTexture(gl.TEXTURE2);
      lutTexture(state, lut);
    }

    gl.uniform2f(at.uRes, width, height);
    gl.uniform2f(at.uProject, pass.project.width, pass.project.height);
    gl.uniform1f(at.uScale, pass.scale);
    gl.uniform1f(at.uTime, pass.time);
    gl.uniform1f(at.uTick, Math.floor(pass.time * GLITCH_RATE + 1e-6));
    gl.uniform1f(at.uGrainTick, Math.floor(pass.time * GRAIN_RATE + 1e-6));
    gl.uniform1f(at.uSharpen, style.sharpen);
    gl.uniform1f(at.uGrain, style.grain);
    gl.uniform1f(at.uPixelate, style.pixelate);
    gl.uniform1f(at.uSplit, style.split);
    gl.uniform1f(at.uGlitch, style.glitch);
    gl.uniform1f(at.uVhs, style.vhs);
    const wheels = grade?.wheels ?? null;
    gl.uniform1f(at.uWheels, wheels ? 1 : 0);
    if (wheels) {
      gl.uniform3f(at.uLift, ...wheels.lift);
      gl.uniform3f(at.uGamma, ...wheels.gamma);
      gl.uniform3f(at.uGain, ...wheels.gain);
    }
    gl.uniform1f(at.uHasCurves, grade?.curves ? 1 : 0);
    gl.uniform1f(at.uLutAmount, lut ? grade!.lutAmount : 0);
    gl.uniform1f(at.uLutSize, lut ? lut.size : 2);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return canvas;
  };
}
